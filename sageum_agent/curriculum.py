from __future__ import annotations

from typing import Any

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


async def generate_curriculum(topic: str, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or load_settings()
    search_payload = await web_search(topic, settings.search_limit)
    sources = search_results_to_sources(search_payload)
    selected_urls = [source["url"] for source in sources[: settings.extract_limit]]
    extract_payload = await web_extract(selected_urls) if selected_urls else {"pages": []}
    pages = extract_payload.get("pages", [])
    if not isinstance(pages, list):
        pages = []

    prompt = f"""Topic: {topic}

Source material:
{_source_brief(pages, sources)}

Create a practical curriculum for a learner. Keep sections concise and ordered.
Return strict JSON matching the schema in the instructions.
"""
    text = await codex_generate_text(
        prompt,
        instructions=INSTRUCTIONS,
        model=settings.codex_model,
        settings=settings,
    )
    curriculum = _normalize_curriculum(extract_json_object(text), topic, sources)
    markdown = render_markdown(curriculum)
    html = render_html(curriculum)
    return {
        "curriculum": curriculum,
        "markdown": markdown,
        "html": html,
        "sources": curriculum.get("sources", sources),
        "search": search_payload,
        "extract": extract_payload,
    }
