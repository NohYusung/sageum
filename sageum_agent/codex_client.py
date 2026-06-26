from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .settings import Settings, load_settings


CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token"
ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 120


class CodexAuthError(RuntimeError):
    pass


@dataclass(frozen=True)
class CodexCredentials:
    access_token: str
    base_url: str
    source: str
    expires_at: int | None = None


def _jwt_claims(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload.encode("utf-8"))
        claims = json.loads(decoded)
    except Exception:
        return {}
    return claims if isinstance(claims, dict) else {}


def _token_expires_at(token: str) -> int | None:
    exp = _jwt_claims(token).get("exp")
    return int(exp) if isinstance(exp, (int, float)) else None


def _is_expiring(token: str, skew_seconds: int = ACCESS_TOKEN_REFRESH_SKEW_SECONDS) -> bool:
    expires_at = _token_expires_at(token)
    if expires_at is None:
        return False
    return expires_at <= int(time.time()) + skew_seconds


def _codex_headers(access_token: str) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "User-Agent": "codex_cli_rs/0.0.0 (Sageum Agent)",
        "originator": "codex_cli_rs",
        "Content-Type": "application/json",
    }
    claims = _jwt_claims(access_token)
    account_id = claims.get("https://api.openai.com/auth", {}).get("chatgpt_account_id")
    if isinstance(account_id, str) and account_id:
        headers["ChatGPT-Account-ID"] = account_id
    return headers


def _read_auth_file(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _extract_tokens(payload: dict[str, Any]) -> dict[str, Any] | None:
    tokens = payload.get("tokens", payload)
    if not isinstance(tokens, dict):
        return None
    access_token = tokens.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        return None
    return dict(tokens)


def _write_sageum_auth_file(path: Path, tokens: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "provider": "openai-codex",
        "tokens": tokens,
        "updated_at": int(time.time()),
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    try:
        path.chmod(0o600)
    except OSError:
        pass


async def _refresh_tokens(refresh_token: str, timeout_seconds: float = 20.0) -> dict[str, Any]:
    import httpx

    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": CODEX_OAUTH_CLIENT_ID,
    }
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(CODEX_OAUTH_TOKEN_URL, data=payload)
    if response.status_code >= 400:
        raise CodexAuthError(f"Codex OAuth refresh failed: HTTP {response.status_code}")
    data = response.json()
    if not isinstance(data, dict) or not isinstance(data.get("access_token"), str):
        raise CodexAuthError("Codex OAuth refresh returned no access_token")
    if "refresh_token" not in data:
        data["refresh_token"] = refresh_token
    return data


async def resolve_codex_credentials(
    settings: Settings | None = None,
    *,
    force_refresh: bool = False,
) -> CodexCredentials:
    settings = settings or load_settings()
    env_token = os.getenv("SAGEUM_CODEX_ACCESS_TOKEN") or os.getenv("CODEX_ACCESS_TOKEN")
    if env_token and env_token.strip():
        token = env_token.strip()
        return CodexCredentials(
            access_token=token,
            base_url=settings.codex_base_url,
            source="env",
            expires_at=_token_expires_at(token),
        )

    candidates = [
        ("sageum-auth-file", settings.codex_auth_file),
        ("codex-cli-auth-file", settings.codex_home / "auth.json"),
    ]
    last_tokens: dict[str, Any] | None = None
    last_source = ""
    for source, path in candidates:
        payload = _read_auth_file(path)
        tokens = _extract_tokens(payload) if payload else None
        if not tokens:
            continue
        last_tokens = tokens
        last_source = source
        access_token = str(tokens.get("access_token", "")).strip()
        refresh_token = str(tokens.get("refresh_token", "")).strip()
        if force_refresh or _is_expiring(access_token):
            if not refresh_token:
                continue
            tokens = await _refresh_tokens(refresh_token)
            access_token = str(tokens["access_token"]).strip()
            _write_sageum_auth_file(settings.codex_auth_file, tokens)
            source = "sageum-auth-file"
        return CodexCredentials(
            access_token=access_token,
            base_url=settings.codex_base_url,
            source=source,
            expires_at=_token_expires_at(access_token),
        )

    if last_tokens and last_source:
        raise CodexAuthError(f"Codex credentials found in {last_source}, but no usable access token was available")
    raise CodexAuthError(
        "No Codex OAuth token found. Set SAGEUM_CODEX_ACCESS_TOKEN or run Codex CLI login so ~/.codex/auth.json exists."
    )


def codex_auth_status(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or load_settings()
    env_token = os.getenv("SAGEUM_CODEX_ACCESS_TOKEN") or os.getenv("CODEX_ACCESS_TOKEN")
    if env_token and env_token.strip():
        token = env_token.strip()
        return {"available": True, "source": "env", "expiresAt": _token_expires_at(token)}

    for source, path in [
        ("sageum-auth-file", settings.codex_auth_file),
        ("codex-cli-auth-file", settings.codex_home / "auth.json"),
    ]:
        payload = _read_auth_file(path)
        tokens = _extract_tokens(payload) if payload else None
        if not tokens:
            continue
        token = str(tokens.get("access_token", "")).strip()
        return {
            "available": bool(token),
            "source": source,
            "path": str(path),
            "expiresAt": _token_expires_at(token) if token else None,
            "expiring": _is_expiring(token) if token else None,
            "hasRefreshToken": bool(tokens.get("refresh_token")),
        }

    return {"available": False, "source": None}


def _extract_response_text(payload: dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    parts: list[str] = []
    output = payload.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            if item.get("type") != "message":
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") in {"output_text", "text"}:
                    text = part.get("text")
                    if isinstance(text, str) and text.strip():
                        parts.append(text.strip())
    return "\n".join(parts).strip()


async def codex_generate_text(
    prompt: str,
    *,
    instructions: str,
    model: str | None = None,
    settings: Settings | None = None,
) -> str:
    import httpx

    settings = settings or load_settings()
    credentials = await resolve_codex_credentials(settings)
    request = {
        "model": model or settings.codex_model,
        "instructions": instructions,
        "input": [{"role": "user", "content": prompt}],
        "store": False,
    }
    url = f"{credentials.base_url.rstrip('/')}/responses"
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            url,
            headers=_codex_headers(credentials.access_token),
            json=request,
        )
    if response.status_code >= 400:
        raise RuntimeError(f"Codex request failed: HTTP {response.status_code}: {response.text[:500]}")
    data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError("Codex response was not a JSON object")
    text = _extract_response_text(data)
    if not text:
        raise RuntimeError("Codex response did not contain text output")
    return text
