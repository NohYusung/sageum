from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _csv_env(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


def _codex_config_model(codex_home: Path) -> str | None:
    config_path = codex_home / "config.toml"
    if not config_path.is_file():
        return None
    try:
        text = config_path.read_text(encoding="utf-8")
    except OSError:
        return None
    match = re.search(r'^\s*model\s*=\s*"([^"]+)"\s*$', text, re.MULTILINE)
    if not match:
        return None
    model = match.group(1).strip()
    return model or None


_CODEX_HOME = Path(os.getenv("CODEX_HOME", "~/.codex")).expanduser()
_DEFAULT_CODEX_MODEL = _codex_config_model(_CODEX_HOME) or "gpt-5.5"


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv("SAGEUM_AGENT_HOST", "127.0.0.1")
    port: int = _int_env("SAGEUM_AGENT_PORT", 4123)
    codex_model: str = os.getenv("SAGEUM_CODEX_MODEL", _DEFAULT_CODEX_MODEL)
    codex_model_fallbacks: list[str] = None
    codex_base_url: str = os.getenv(
        "SAGEUM_CODEX_BASE_URL",
        "https://chatgpt.com/backend-api/codex",
    ).rstrip("/")
    codex_auth_file: Path = Path(
        os.getenv("SAGEUM_CODEX_AUTH_FILE", "~/.sageum-agent/auth.json")
    ).expanduser()
    codex_home: Path = _CODEX_HOME
    search_limit: int = _int_env("SAGEUM_SEARCH_LIMIT", 5)
    extract_limit: int = _int_env("SAGEUM_EXTRACT_LIMIT", 3)
    callback_timeout_seconds: float = _float_env("SAGEUM_CALLBACK_TIMEOUT_SECONDS", 20.0)

    def __post_init__(self) -> None:
        if self.codex_model_fallbacks is None:
            object.__setattr__(
                self,
                "codex_model_fallbacks",
                _csv_env(
                    "SAGEUM_CODEX_MODEL_FALLBACKS",
                    ["gpt-5.5", "gpt-5.4", "gpt-5", "gpt-5-codex", "gpt-5.2-codex"],
                ),
            )


def load_settings() -> Settings:
    return Settings()
