from __future__ import annotations

import asyncio
import html
import json
import os
import re
import urllib.parse
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any, Optional

import httpx


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str = ""

    def to_payload(self) -> dict[str, str]:
        return {"title": self.title, "url": self.url, "snippet": self.snippet}


class _ReadableHTMLParser(HTMLParser):
    """Extract a page title and readable body text through HTMLParser callbacks.

    _extract_direct creates a fresh parser per page, then feed() calls handle_* methods
    on this instance. __init__ prepares both HTMLParser internals and per-page state.
    """

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


class _DuckDuckGoHTMLParser(HTMLParser):
    def __init__(self, limit: int) -> None:
        super().__init__()
        self.limit = limit
        self.results: list[SearchResult] = []
        self._title_href = ""
        self._title_parts: list[str] = []
        self._snippet_parts: list[str] = []
        self._capturing_title = False
        self._capturing_snippet = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if len(self.results) >= self.limit:
            return
        attr_map = {name.lower(): value or "" for name, value in attrs}
        classes = set(attr_map.get("class", "").split())
        if tag.lower() == "a" and "result__a" in classes:
            self._title_href = attr_map.get("href", "")
            self._title_parts = []
            self._capturing_title = True
        elif "result__snippet" in classes and self.results:
            self._snippet_parts = []
            self._capturing_snippet = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._capturing_title:
            title = _clean_inline_text(" ".join(self._title_parts))
            url = _decode_duckduckgo_url(self._title_href)
            if title and url and _is_public_result_url(url):
                self.results.append(SearchResult(title=title, url=url))
            self._title_href = ""
            self._title_parts = []
            self._capturing_title = False
        elif self._capturing_snippet and tag.lower() in {"a", "div"}:
            snippet = _clean_inline_text(" ".join(self._snippet_parts))
            if snippet and self.results:
                last = self.results[-1]
                self.results[-1] = SearchResult(title=last.title, url=last.url, snippet=snippet)
            self._snippet_parts = []
            self._capturing_snippet = False

    def handle_data(self, data: str) -> None:
        if self._capturing_title:
            self._title_parts.append(data)
        elif self._capturing_snippet:
            self._snippet_parts.append(data)


def _env_value(*names: str) -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return ""


def _clean_inline_text(value: str) -> str:
    value = html.unescape(value)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _decode_duckduckgo_url(url: str) -> str:
    url = html.unescape(str(url or "").strip())
    if url.startswith("//"):
        url = f"https:{url}"
    parsed = urllib.parse.urlparse(url)
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
        query = urllib.parse.parse_qs(parsed.query)
        target = query.get("uddg", [""])[0]
        if target:
            return urllib.parse.unquote(target).strip()
    return url


def _is_public_result_url(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False
    if not parsed.netloc:
        return False
    blocked_hosts = {"duckduckgo.com", "www.duckduckgo.com"}
    return parsed.netloc.lower() not in blocked_hosts


def _merge_results(items: list[SearchResult], limit: int) -> list[SearchResult]:
    merged: list[SearchResult] = []
    seen: set[str] = set()
    for item in items:
        url = item.url.strip()
        if not _is_public_result_url(url):
            continue
        key = url.rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        merged.append(item)
        if len(merged) >= limit:
            break
    return merged


def _search_backend() -> str:
    configured = _env_value("SAGEUM_WEB_BACKEND")
    configured = configured.lower().strip()
    aliases = {
        "brave-free": "brave",
        "brave_search": "brave",
        "ddg": "duckduckgo",
        "duck": "duckduckgo",
        "free": "duckduckgo",
        "jina": "duckduckgo",
        "jina-ddg": "duckduckgo",
        "searxng": "searxng",
        "tavily": "tavily",
        "exa": "exa",
    }
    configured = aliases.get(configured, configured)
    if configured in {"searxng", "brave", "tavily", "exa", "duckduckgo", "none"}:
        return configured
    if _env_value("SAGEUM_SEARXNG_URL"):
        return "searxng"
    if _env_value("SAGEUM_BRAVE_SEARCH_API_KEY"):
        return "brave"
    if _env_value("SAGEUM_TAVILY_API_KEY"):
        return "tavily"
    if _env_value("SAGEUM_EXA_API_KEY"):
        return "exa"
    return "duckduckgo"


def _jina_reader_url(url: str) -> str:
    url = str(url or "").strip()
    if url.startswith("https://"):
        return "https://r.jina.ai/http://" + url[len("https://") :]
    if url.startswith("http://"):
        return "https://r.jina.ai/http://" + url[len("http://") :]
    return ""


def _parse_duckduckgo_html(text: str, limit: int) -> list[SearchResult]:
    parser = _DuckDuckGoHTMLParser(limit=limit)
    parser.feed(text)
    return parser.results[:limit]


def _strip_markdown_link_text(value: str) -> str:
    value = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    return _clean_inline_text(value)


def _parse_jina_duckduckgo_markdown(text: str, limit: int) -> list[SearchResult]:
    matches = list(re.finditer(r"^##\s+\[([^\]]+)\]\(([^)]+)\)\s*$", text, re.MULTILINE))
    results: list[SearchResult] = []
    for index, match in enumerate(matches):
        title = _strip_markdown_link_text(match.group(1))
        url = _decode_duckduckgo_url(match.group(2))
        if not title or title.lower() in {"duckduckgo", "images"}:
            continue
        if not _is_public_result_url(url):
            continue
        block_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.end() : block_end]
        lines = []
        for raw_line in block.splitlines():
            line = _strip_markdown_link_text(raw_line)
            if not line or line == title or line.startswith("http"):
                continue
            if line.lower().startswith("url source:"):
                continue
            lines.append(line)
            if len(" ".join(lines)) > 450:
                break
        results.append(SearchResult(title=title, url=url, snippet=" ".join(lines)[:500].strip()))
        if len(results) >= limit:
            break
    return results


async def _search_duckduckgo(query: str, limit: int) -> list[SearchResult]:
    headers = {"User-Agent": "Mozilla/5.0 (compatible; SageumAgent/0.1)"}
    direct_url = "https://duckduckgo.com/html/"
    jina_url = "https://r.jina.ai/http://duckduckgo.com/html/?q=" + urllib.parse.quote(query)
    results: list[SearchResult] = []
    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=headers) as client:
        try:
            direct = await client.get(direct_url, params={"q": query})
            direct.raise_for_status()
            results.extend(_parse_duckduckgo_html(direct.text, limit))
        except Exception:
            pass
        if len(_merge_results(results, limit)) < limit:
            jina = await client.get(jina_url)
            jina.raise_for_status()
            results.extend(_parse_jina_duckduckgo_markdown(jina.text, limit))
    return _merge_results(results, limit)


async def _search_searxng(query: str, limit: int) -> list[SearchResult]:
    base_url = _env_value("SAGEUM_SEARXNG_URL").rstrip("/")
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
    api_key = _env_value("SAGEUM_BRAVE_SEARCH_API_KEY")
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


async def _search_tavily(query: str, limit: int) -> list[SearchResult]:
    api_key = _env_value("SAGEUM_TAVILY_API_KEY")
    if not api_key:
        return []
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        response = await client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": api_key,
                "query": query,
                "max_results": min(max(limit, 1), 10),
                "search_depth": "basic",
            },
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


async def _search_exa(query: str, limit: int) -> list[SearchResult]:
    api_key = _env_value("SAGEUM_EXA_API_KEY")
    if not api_key:
        return []
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        response = await client.post(
            "https://api.exa.ai/search",
            headers={"x-api-key": api_key, "Content-Type": "application/json"},
            json={"query": query, "numResults": min(max(limit, 1), 10)},
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
                snippet=str(item.get("text") or item.get("summary") or "").strip(),
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
        elif backend == "tavily":
            results = await _search_tavily(query, limit)
        elif backend == "exa":
            results = await _search_exa(query, limit)
        elif backend == "duckduckgo":
            results = await _search_duckduckgo(query, limit)
        else:
            results = []
    except Exception as exc:
        return {"backend": backend, "results": [], "error": str(exc)}
    return {"backend": backend, "results": [item.to_payload() for item in results]}


async def _extract_direct(
    client: httpx.AsyncClient,
    url: str,
    *,
    max_chars: int,
) -> dict[str, Any]:
    response = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; SageumAgent/0.1)"})
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


async def _extract_jina(
    client: httpx.AsyncClient,
    url: str,
    *,
    max_chars: int,
) -> dict[str, Any]:
    reader_url = _jina_reader_url(url)
    if not reader_url:
        raise ValueError("jina reader supports only http(s) URLs")
    response = await client.get(
        reader_url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; SageumAgent/0.1)"},
    )
    response.raise_for_status()
    text = response.text
    title = url
    match = re.search(r"^Title:\s*(.+?)\s*$", text, re.MULTILINE)
    if match:
        title = _clean_inline_text(match.group(1)) or url
    marker = "Markdown Content:"
    marker_index = text.find(marker)
    if marker_index >= 0:
        text = text[marker_index + len(marker) :].strip()
    text = text[:max_chars].strip()
    return {
        "url": url,
        "title": title,
        "content": text,
        "contentType": "text/markdown; reader=jina",
        "readerUrl": reader_url,
    }


def _extract_reader_mode() -> str:
    configured = _env_value("SAGEUM_EXTRACT_READER").lower().strip()
    if configured in {"direct", "jina", "auto"}:
        return configured
    return "jina"


async def extract_url(url: str, *, max_chars: int = 18000) -> dict[str, Any]:
    mode = _extract_reader_mode()
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        if mode == "direct":
            return await _extract_direct(client, url, max_chars=max_chars)
        if mode == "jina":
            try:
                return await _extract_jina(client, url, max_chars=max_chars)
            except Exception:
                return await _extract_direct(client, url, max_chars=max_chars)

        direct_result: Optional[dict[str, Any]] = None
        direct_error = ""
        try:
            direct_result = await _extract_direct(client, url, max_chars=max_chars)
            if len(str(direct_result.get("content") or "")) >= 700:
                return direct_result
        except Exception as exc:
            direct_error = str(exc)
        try:
            jina_result = await _extract_jina(client, url, max_chars=max_chars)
            if direct_error:
                jina_result["directError"] = direct_error
            return jina_result
        except Exception as exc:
            if direct_result is not None:
                direct_result["readerError"] = str(exc)
                return direct_result
            raise


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
