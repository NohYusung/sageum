from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any

from .codex_client import codex_auth_status


def _print_header() -> None:
    print("Sageum Agent")
    print("Type a learning topic. Commands: /help, /status, /last, /quit")
    print()


def _print_help() -> None:
    print("Commands")
    print("- /help: show commands")
    print("- /status: show Codex OAuth status")
    print("- /last: print the previous result markdown")
    print("- /quit: exit")
    print()


def _print_status() -> None:
    print(json.dumps(codex_auth_status(), ensure_ascii=False, indent=2))
    print()


def _event_printer(event: str, payload: dict[str, Any]) -> None:
    if event == "input":
        print(f"[input] {payload.get('topic')}")
    elif event == "search_started":
        print(f"[search] query={payload.get('query')!r} limit={payload.get('limit')}")
    elif event == "search_finished":
        error = payload.get("error")
        suffix = f" error={error}" if error else ""
        print(f"[search] backend={payload.get('backend')} results={payload.get('count')}{suffix}")
    elif event == "extract_started":
        print(f"[extract] pages={payload.get('count')}")
    elif event == "extract_finished":
        print(f"[extract] done={payload.get('count')}")
    elif event == "model_started":
        print(f"[model] {payload.get('model')}")
    elif event == "model_finished":
        print(f"[model] output_chars={payload.get('chars')}")
    elif event == "render_finished":
        print(
            "[render] "
            f"sections={payload.get('sections')} "
            f"markdown={payload.get('markdownChars')} "
            f"html={payload.get('htmlChars')}"
        )


def _save_local_result(topic: str, result: dict[str, Any]) -> Path:
    safe_topic = "".join(ch if ch.isalnum() else "-" for ch in topic.lower()).strip("-")[:48]
    suffix = int(time.time())
    out_dir = Path("data") / "local-sessions"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{suffix}-{safe_topic or 'topic'}.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


async def _run_topic(topic: str) -> dict[str, Any] | None:
    from .curriculum import generate_curriculum

    try:
        result = await generate_curriculum(topic, on_event=_event_printer)
    except KeyboardInterrupt:
        print("\n[cancelled]")
        return None
    except Exception as exc:
        print(f"[error] {exc}")
        return None

    path = _save_local_result(topic, result)
    print(f"[saved] {path}")
    print()
    print(result["markdown"])
    return result


def main(argv: list[str] | None = None) -> int:
    del argv
    _print_header()
    last_result: dict[str, Any] | None = None

    while True:
        try:
            topic = input("sageum> ").strip()
        except EOFError:
            print()
            return 0
        except KeyboardInterrupt:
            print()
            return 130

        if not topic:
            continue
        command = topic.lower()
        if command in {"/q", "/quit", "quit", "exit"}:
            return 0
        if command == "/help":
            _print_help()
            continue
        if command == "/status":
            _print_status()
            continue
        if command == "/last":
            if last_result:
                print(last_result["markdown"])
            else:
                print("No previous result.")
            continue

        last_result = asyncio.run(_run_topic(topic))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
