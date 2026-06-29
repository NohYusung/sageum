from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Union

from .codex_client import codex_generate_text
from .rendering import render_html, render_markdown
from .settings import Settings, load_settings
from .web import extract_json_object, search_results_to_sources, web_extract, web_search


INSTRUCTIONS = """You are Sageum Agent, a curriculum generation worker.
Return only strict JSON. Do not wrap the response in markdown.
The JSON schema is:
{
  "topic": string,
  "summary": string,
  "prerequisites": string[],
  "sections": [
    {
      "title": string,
      "lessons": [{"title": string, "goal": string}]
    }
  ],
  "sources": [{"title": string, "url": string}]
}
Use the supplied source excerpts as grounding material.
"""


def _source_brief(pages: list[dict[str, Any]], fallback_sources: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for index, page in enumerate(pages, start=1):
        title = str(page.get("title") or page.get("url") or f"Source {index}")
        url = str(page.get("url") or "")
        content = str(page.get("content") or "").strip()
        if not content:
            continue
        chunks.append(f"[{index}] {title}\nURL: {url}\nExcerpt:\n{content[:6000]}")
    if chunks:
        return "\n\n".join(chunks)
    if fallback_sources:
        return "\n".join(
            f"- {source.get('title') or source.get('url')}: {source.get('snippet') or ''} ({source.get('url')})"
            for source in fallback_sources
        )
    return "No external source excerpts were available."

# Union[A, B]는 값의 타입이 A 또는 B일 수 있다는 타입 힌트다.
# 여기서는 진행 콜백이 None을 반환하거나, await 가능한 None 결과를 반환할 수 있음을 뜻한다.
# None은 TypeScript의 any처럼 아무 타입이나 허용한다는 뜻이 아니다.
# Python에서 None은 "값 없음"을 나타내는 단일 값이며, TypeScript의 null/undefined에 더 가깝다.
ProgressHandler = Callable[[str, dict[str, Any]], Union[None, Awaitable[None]]]


# 앞의 밑줄은 모듈 내부용 헬퍼라는 관례다. 진행 이벤트를 콜백에 전달하고,
# 콜백이 awaitable을 반환하면 기다려 비동기 핸들러도 같은 방식으로 처리한다.
async def _emit_progress(
    handler: ProgressHandler | None,
    event: str,
    payload: dict[str, Any] | None = None,
) -> None:
    if handler is None:
        return
    result = handler(event, payload or {})
    if hasattr(result, "__await__"):
        await result


def _normalize_curriculum(raw: dict[str, Any], topic: str, sources: list[dict[str, Any]]) -> dict[str, Any]:
    raw["topic"] = str(raw.get("topic") or topic)
    if not isinstance(raw.get("summary"), str):
        raw["summary"] = ""
    if not isinstance(raw.get("prerequisites"), list):
        raw["prerequisites"] = []
    if not isinstance(raw.get("sections"), list):
        raw["sections"] = []
    if not isinstance(raw.get("sources"), list) or not raw["sources"]:
        raw["sources"] = [{"title": source["title"], "url": source["url"]} for source in sources if source.get("url")]
    return raw


async def generate_curriculum(
    topic: str,
    settings: Settings | None = None,
    on_event: ProgressHandler | None = None,
) -> dict[str, Any]:
    settings = settings or load_settings()
    await _emit_progress(on_event, "input", {"topic": topic})
    await _emit_progress(on_event, "search_started", {"query": topic, "limit": settings.search_limit})
    search_payload = await web_search(topic, settings.search_limit)
    search_results = search_payload.get("results", [])
    await _emit_progress(
        on_event,
        "search_finished",
        {
            "backend": search_payload.get("backend"),
            "count": len(search_results) if isinstance(search_results, list) else 0,
            "error": search_payload.get("error"),
        },
    )
    sources = search_results_to_sources(search_payload)
    selected_urls = [source["url"] for source in sources[: settings.extract_limit]]
    await _emit_progress(on_event, "extract_started", {"count": len(selected_urls), "urls": selected_urls})
    extract_payload = await web_extract(selected_urls) if selected_urls else {"pages": []}
    pages = extract_payload.get("pages", [])
    if not isinstance(pages, list):
        pages = []
    await _emit_progress(on_event, "extract_finished", {"count": len(pages)})

    prompt = f"""Topic: {topic}

Source material:
{_source_brief(pages, sources)}

Create a practical curriculum for a learner. Keep sections concise and ordered.
Return strict JSON matching the schema in the instructions.
"""
    await _emit_progress(on_event, "model_started", {"model": settings.codex_model})
    text = await codex_generate_text(
        prompt,
        instructions=INSTRUCTIONS,
        model=settings.codex_model,
        settings=settings,
    )
    await _emit_progress(on_event, "model_finished", {"chars": len(text)})
    curriculum = _normalize_curriculum(extract_json_object(text), topic, sources)
    markdown = render_markdown(curriculum)
    html = render_html(curriculum)
    await _emit_progress(
        on_event,
        "render_finished",
        {
            "sections": len(curriculum.get("sections", [])),
            "markdownChars": len(markdown),
            "htmlChars": len(html),
        },
    )
    return {
        "curriculum": curriculum,
        "markdown": markdown,
        "html": html,
        "sources": curriculum.get("sources", sources),
        "search": search_payload,
        "extract": extract_payload,
    }
