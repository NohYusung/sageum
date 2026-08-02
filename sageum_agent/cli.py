from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any

from .contracts import JobRequest, JobResult
from .rendering import render_html, render_markdown, render_obsidian_frontmatter, render_obsidian_markdown
from .settings import load_settings


def _read_json_stdin() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise SystemExit("Expected JSON on stdin.")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise SystemExit("Expected a JSON object.")
    return payload


def _cmd_validate_job(_: argparse.Namespace) -> int:
    request = JobRequest.from_payload(_read_json_stdin())
    print(json.dumps(request.to_payload(), ensure_ascii=False))
    return 0

def _cmd_render(args: argparse.Namespace) -> int:
    curriculum = _read_json_stdin()
    markdown = render_obsidian_markdown(curriculum) if args.format == "obsidian" else render_markdown(curriculum)
    payload = {
        "markdown": markdown,
        "html": render_html(curriculum),
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def _cmd_tools(_: argparse.Namespace) -> int:
    from .toolsets import resolve_toolset

    print(json.dumps({"toolset": "sageum-agent", "tools": resolve_toolset("sageum-agent")}))
    return 0


def _cmd_codex_auth_status(_: argparse.Namespace) -> int:
    from .codex_client import codex_auth_status

    print(json.dumps(codex_auth_status(), ensure_ascii=False))
    return 0


def _cmd_run_job(args: argparse.Namespace) -> int:
    from .curriculum import generate_curriculum

    request = JobRequest.from_payload(_read_json_stdin())

    async def run() -> JobResult:
        try:
            generated = await generate_curriculum(request.topic)
            curriculum = generated["curriculum"]
            markdown = (
                render_obsidian_markdown(curriculum)
                if args.format == "obsidian"
                else generated["markdown"]
            )
            return JobResult.completed(
                job_id=request.job_id,
                markdown=markdown,
                html=generated["html"],
                sources=generated.get("sources", []),
                obsidian_frontmatter={"raw": render_obsidian_frontmatter(curriculum)}
                if args.format == "obsidian"
                else None,
                concepts=curriculum.get("concepts", []),
                mentions=curriculum.get("mentions", []),
                relations=curriculum.get("relations", []),
                source_links=curriculum.get("sources", generated.get("sources", [])),
                suggested_filename=f"{curriculum.get('topic') or request.topic}.md",
            )
        except Exception as exc:
            return JobResult.failed(job_id=request.job_id, error=str(exc))

    result = asyncio.run(run())
    print(json.dumps(result.to_payload(), ensure_ascii=False))
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    settings = load_settings()
    uvicorn.run(
        "sageum_agent.server:app",
        host=args.host or settings.host,
        port=args.port or settings.port,
        reload=False,
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sageum-agent",
        description="Sageum curriculum worker surface",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    validate = subcommands.add_parser("validate-job", help="Validate backend job JSON from stdin")
    validate.set_defaults(func=_cmd_validate_job)

    render = subcommands.add_parser("render", help="Render curriculum JSON to markdown and HTML")
    render.add_argument("--format", choices=["markdown", "obsidian"], default="markdown")
    render.set_defaults(func=_cmd_render)

    tools = subcommands.add_parser("tools", help="Print the minimal Sageum agent toolset")
    tools.set_defaults(func=_cmd_tools)

    run_job = subcommands.add_parser("run-job", help="Run one backend job JSON from stdin")
    run_job.add_argument("--format", choices=["markdown", "obsidian"], default="markdown")
    run_job.set_defaults(func=_cmd_run_job)

    status_cmd = subcommands.add_parser("codex-auth-status", help="Print Codex OAuth token availability")
    status_cmd.set_defaults(func=_cmd_codex_auth_status)

    serve = subcommands.add_parser("serve", help="Start the Sageum Agent HTTP worker")
    serve.add_argument("--host", default=None)
    serve.add_argument("--port", type=int, default=None)
    serve.set_defaults(func=_cmd_serve)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
