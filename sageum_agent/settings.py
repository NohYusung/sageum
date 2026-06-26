from __future__ import annotations

import os
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


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv("SAGEUM_AGENT_HOST", "127.0.0.1")
    port: int = _int_env("SAGEUM_AGENT_PORT", 4123)
    codex_model: str = os.getenv("SAGEUM_CODEX_MODEL", "gpt-5.3-codex")
    codex_base_url: str = os.getenv(
        "SAGEUM_CODEX_BASE_URL",
        "https://chatgpt.com/backend-api/codex",
    ).rstrip("/")
    codex_auth_file: Path = Path(
        os.getenv("SAGEUM_CODEX_AUTH_FILE", "~/.sageum-agent/auth.json")
    ).expanduser()
    codex_home: Path = Path(os.getenv("CODEX_HOME", "~/.codex")).expanduser()
    search_limit: int = _int_env("SAGEUM_SEARCH_LIMIT", 5)
    extract_limit: int = _int_env("SAGEUM_EXTRACT_LIMIT", 3)
    callback_timeout_seconds: float = _float_env("SAGEUM_CALLBACK_TIMEOUT_SECONDS", 20.0)


def load_settings() -> Settings:
    return Settings()
