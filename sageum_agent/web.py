from __future__ import annotations

import asyncio
import html
import json
import os
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin

import httpx


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str = ""

    def to_payload(self) -> dict[str, str]:
        return {"title": self.title, "url": self.url, "snippet": self.snippet}


class _ReadableHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self._in_title = False
        self._skip_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = True
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
        if tag in {"p", "br", "li", "h1", "h2", "h3", "h4", "tr"}:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = False
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1
        if tag in {"p", "li", "h1", "h2", "h3", "h4", "tr"}:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        text = html.unescape(data).strip()
        if not text:
            return
        if self._in_title:
            self.title = f"{self.title} {text}".strip()
            return
        if self._skip_depth:
            return
        self._parts.append(text)
        self._parts.append(" ")

    def readable_text(self) -> str:
        text = "".join(self._parts)
        text = re.sub(r"[ \t\r\f\v]+", " ", text)
        text = re.sub(r"\n\s+", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


def _search_backend() -> str:
    if os.getenv("SAGEUM_SEARXNG_URL"):
        return "searxng"
    if os.getenv("BRAVE_SEARCH_API_KEY"):
        return "brave"
    return "none"


async def _search_searxng(query: str, limit: int) -> list[SearchResult]:
    base_url = os.getenv("SAGEUM_SEARXNG_URL", "").strip().rstrip("/")
    if not base_url:
        return []
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        response = await client.get(
            f"{base_url}/search",
            params={"q": query, "format": "json", "language": "auto"},
        )
    response.raise_for_status()
    data = response.json()
    results = data.get("results", []) if isinstance(data, dict) else []
    output: list[SearchResult] = []
    for item in results[:limit]:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        output.append(
            SearchResult(
                title=str(item.get("title") or url).strip(),
                url=url,
                snippet=str(item.get("content") or "").strip(),
            )
        )
    return output


async def _search_brave(query: str, limit: int) -> list[SearchResult]:
    api_key = os.getenv("BRAVE_SEARCH_API_KEY", "").strip()
    if not api_key:
        return []
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        response = await client.get(
            "https://api.search.brave.com/res/v1/web/search",
            headers={"X-Subscription-Token": api_key, "Accept": "application/json"},
            params={"q": query, "count": min(max(limit, 1), 10)},
        )
    response.raise_for_status()
    data = response.json()
    web = data.get("web", {}) if isinstance(data, dict) else {}
    results = web.get("results", []) if isinstance(web, dict) else []
    output: list[SearchResult] = []
    for item in results[:limit]:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        output.append(
            SearchResult(
                title=str(item.get("title") or url).strip(),
                url=url,
                snippet=str(item.get("description") or "").strip(),
            )
        )
    return output


async def web_search(query: str, limit: int = 5) -> dict[str, Any]:
    query = " ".join(str(query or "").split())
    if not query:
        return {"backend": _search_backend(), "results": [], "error": "query is required"}
    limit = min(max(int(limit or 5), 1), 10)
    backend = _search_backend()
    try:
        if backend == "searxng":
            results = await _search_searxng(query, limit)
        elif backend == "brave":
            results = await _search_brave(query, limit)
        else:
            results = []
    except Exception as exc:
        return {"backend": backend, "results": [], "error": str(exc)}
    return {"backend": backend, "results": [item.to_payload() for item in results]}


async def extract_url(url: str, *, max_chars: int = 18000) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        response = await client.get(url, headers={"User-Agent": "SageumAgent/0.1"})
    response.raise_for_status()
    content_type = response.headers.get("content-type", "")
    text = response.text
    title = url
    if "html" in content_type.lower() or "<html" in text[:500].lower():
        parser = _ReadableHTMLParser()
        parser.feed(text)
        title = parser.title or url
        text = parser.readable_text()
    else:
        text = html.unescape(text)
    text = text[:max_chars].strip()
    return {"url": url, "title": title, "content": text, "contentType": content_type}


async def web_extract(urls: list[str]) -> dict[str, Any]:
    clean_urls = [str(url).strip() for url in urls if isinstance(url, str) and str(url).strip()]
    clean_urls = clean_urls[:5]
    pages: list[dict[str, Any]] = []
    for url in clean_urls:
        try:
            pages.append(await extract_url(url))
        except Exception as exc:
            pages.append({"url": url, "title": url, "content": "", "error": str(exc)})
    return {"pages": pages}


def web_search_sync(query: str, limit: int = 5) -> dict[str, Any]:
    return asyncio.run(web_search(query, limit))


def web_extract_sync(urls: list[str]) -> dict[str, Any]:
    return asyncio.run(web_extract(urls))


def search_results_to_sources(payload: dict[str, Any]) -> list[dict[str, Any]]:
    results = payload.get("results", [])
    if not isinstance(results, list):
        return []
    sources: list[dict[str, Any]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        sources.append(
            {
                "title": str(item.get("title") or url).strip(),
                "url": url,
                "snippet": str(item.get("snippet") or "").strip(),
            }
        )
    return sources


def extract_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped)
    try:
        data = json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start < 0 or end <= start:
            raise
        data = json.loads(stripped[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object")
    return data
