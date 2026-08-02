from __future__ import annotations

from collections import Counter
from collections.abc import Awaitable, Callable
import hashlib
import json
from pathlib import Path
import re
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
      "content": string,
      "diagram": string,
      "lessons": [{"title": string, "goal": string}]
    }
  ],
  "concepts": [{"id": string, "name": string, "aliases": string[], "type": string, "definition": string}],
  "mentions": [{"text": string, "concept_id": string, "heading": string, "confidence": number}],
  "relations": [{"source": string, "relation_type": string, "target": string, "evidence_text": string, "confidence": number}],
  "obsidian_aliases": string[],
  "obsidian_tags": string[],
  "sources": [{"title": string, "url": string}]
}
Use the supplied source excerpts as grounding material.
"""

STUDY_NOTE_SECTION_TITLES = [
    "한 줄 요약",
    "왜 중요한가",
    "핵심 개념",
    "아키텍처 또는 흐름",
    "중요한 세부사항, edge case, tradeoff",
    "실전 예시",
    "용어집 또는 빠른 복습",
]

STUDY_NOTE_SKILL_PATH = Path(__file__).resolve().parent / "skills" / "study-note-writer" / "SKILL.md"


def _read_study_note_skill() -> str:
    try:
        return STUDY_NOTE_SKILL_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _study_note_instructions() -> str:
    section_order = "\n".join(f"{index}. {title}" for index, title in enumerate(STUDY_NOTE_SECTION_TITLES, start=1))
    skill_text = _read_study_note_skill()
    skill_block = f"\n\nLocal study-note-writer skill:\n{skill_text}" if skill_text else ""
    return f"""{INSTRUCTIONS}

Apply the local study-note-writer skill as the output-shape guide.{skill_block}

Adapt the skill rules to this worker contract:
- Do not create directories or files; this worker only returns JSON, markdown, and HTML payloads.
- Keep the response as strict JSON matching the schema above.
- Write Korean output unless the user topic clearly requires another language.
- Use this exact section order:
{section_order}
- Each section must include explanatory Korean prose in "content".
- Each section must include a Mermaid diagram source string in "diagram".
- Put only raw Mermaid source in "diagram"; do not wrap it in markdown code fences.
- Include candidate concepts with name, aliases, type, and definition.
- Include candidate relations with source, relation_type, target, evidence_text, and confidence.
- Include Obsidian aliases and tags suitable for YAML frontmatter.
- Keep sources grounded in the supplied search and extraction material.
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


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _normalize_concepts(value: Any) -> list[dict[str, Any]]:
    concepts: list[dict[str, Any]] = []
    if not isinstance(value, list):
        return concepts
    for item in value:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        concepts.append(
            {
                "id": str(item.get("id") or "").strip(),
                "name": name,
                "aliases": _string_list(item.get("aliases")),
                "type": str(item.get("type") or "").strip(),
                "definition": str(item.get("definition") or "").strip(),
            }
        )
    return concepts


def _normalize_mentions(value: Any) -> list[dict[str, Any]]:
    mentions: list[dict[str, Any]] = []
    if not isinstance(value, list):
        return mentions
    for item in value:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        mentions.append(
            {
                "text": text,
                "concept_id": str(item.get("concept_id") or item.get("conceptId") or "").strip(),
                "heading": str(item.get("heading") or "").strip(),
                "confidence": float(item.get("confidence") or 0),
            }
        )
    return mentions


def _stable_relation_id(source: str, relation_type: str, target: str, evidence_text: str) -> str:
    raw = "\n".join([source, relation_type, target, evidence_text])
    return f"rel_{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:12]}"


def _normalize_relations(value: Any) -> list[dict[str, Any]]:
    relations: list[dict[str, Any]] = []
    if not isinstance(value, list):
        return relations
    for item in value:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source") or item.get("source_concept_id") or "").strip()
        relation_type = str(item.get("relation_type") or "").strip()
        target = str(item.get("target") or item.get("target_concept_id") or "").strip()
        evidence_text = str(item.get("evidence_text") or "").strip()
        if not source or not relation_type or not target or not evidence_text:
            continue
        relations.append(
            {
                "relation_id": str(item.get("relation_id") or item.get("relationId") or "").strip()
                or _stable_relation_id(source, relation_type, target, evidence_text),
                "source": source,
                "relation_type": relation_type,
                "target": target,
                "evidence_text": evidence_text,
                "confidence": float(item.get("confidence") or 0),
                "status": str(item.get("status") or "candidate").strip(),
            }
        )
    return relations


_TOKEN_RE = re.compile(r"[A-Za-z0-9가-힣][A-Za-z0-9가-힣·+_-]*")
_MERMAID_LABEL_RE = re.compile(r"[\[\(\{]{1,2}([^\]\)\}\n]{2,60})[\]\)\}]{1,2}")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?。！？])\s+|\n+")
_PARTICLE_SUFFIXES = (
    "으로부터",
    "에게서",
    "에서는",
    "으로는",
    "이라는",
    "라는",
    "에서",
    "에게",
    "부터",
    "까지",
    "처럼",
    "보다",
    "으로",
    "으로",
    "라도",
    "이며",
    "이고",
    "이라",
    "은",
    "는",
    "이",
    "가",
    "을",
    "를",
    "과",
    "와",
    "로",
    "에",
    "도",
    "만",
)
_STOP_TOKENS = {
    "그리고",
    "하지만",
    "또는",
    "또한",
    "먼저",
    "다음",
    "마지막",
    "예를",
    "위해",
    "통해",
    "대한",
    "대해",
    "있는",
    "없는",
    "있다",
    "없다",
    "한다",
    "된다",
    "해야",
    "하면",
    "따라",
    "같은",
    "이후",
    "이전",
    "현재",
    "상황",
    "단계",
    "과정",
    "방법",
    "예시",
    "복습",
    "정리",
    "개념",
}
_TRAILING_STOP_TOKENS = {
    "확인",
    "점검",
    "설명",
    "이해",
    "연습",
    "훈련",
    "방법",
    "기준",
    "이유",
    "예시",
    "복습",
    "정리",
    "선택",
    "습관",
}
_STOP_PHRASES = {
    "한 줄 요약",
    "왜 중요한가",
    "핵심 개념",
    "아키텍처",
    "흐름",
    "실전 예시",
    "용어집",
    "빠른 복습",
    "참고 링크",
}


def _strip_particle(token: str) -> str:
    cleaned = token.strip(" \t\r\n.,:;!?()[]{}<>\"'`*_#")
    for suffix in _PARTICLE_SUFFIXES:
        if cleaned.endswith(suffix) and len(cleaned) - len(suffix) >= 2:
            return cleaned[: -len(suffix)]
    return cleaned


def _clean_semantic_phrase(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"\[\[([^|\]]+\|)?([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[`*_#>\"'“”‘’]", " ", text)
    text = re.sub(r"[\\/|:;,.!?()\[\]{}<>]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" -–—·")
    if not text:
        return ""

    words = [_strip_particle(word) for word in text.split()]
    words = [word for word in words if word and word not in _STOP_TOKENS]
    while words and words[-1] in _TRAILING_STOP_TOKENS:
        words.pop()
    phrase = " ".join(words).strip()
    if not phrase or phrase in _STOP_PHRASES:
        return ""
    if len(phrase) < 2 or len(phrase) > 32:
        return ""
    if len(phrase.split()) > 4:
        return ""
    if not re.search(r"[A-Za-z가-힣]", phrase):
        return ""
    return phrase


def _dedupe_strings(values: list[str], limit: int | None = None) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = re.sub(r"\s+", " ", str(value or "")).strip()
        key = normalized.lower()
        if not normalized or key in seen:
            continue
        seen.add(key)
        output.append(normalized)
        if limit is not None and len(output) >= limit:
            break
    return output


def _infer_domain(topic: str) -> str:
    lower = topic.lower()
    if any(keyword in lower for keyword in ("리그오브레전드", "league of legends", "lol")):
        return "league-of-legends"
    if any(keyword in lower for keyword in ("파이썬", "python")):
        return "python"
    return "general"


def _infer_intent(topic: str) -> str:
    lower = topic.lower()
    if any(keyword in lower for keyword in ("방법", "잘하는", "how to", "guide")):
        return "how-to-guide"
    if any(keyword in lower for keyword in ("원리", "이해", "구조", "개념", "why", "how does")):
        return "explainer"
    if any(keyword in lower for keyword in ("요약", "정리", "치트시트", "summary")):
        return "summary-note"
    return "study-note"


def _freshness_required(topic: str, domain: str) -> bool:
    lower = topic.lower()
    if domain in {"league-of-legends"}:
        return True
    return any(keyword in lower for keyword in ("최신", "current", "recent", "2025", "2026", "오늘", "이번"))


def _topic_terms(topic: str) -> list[str]:
    cleaned = _clean_semantic_phrase(topic)
    terms = [cleaned] if cleaned else []
    tokens = [_strip_particle(match.group(0)) for match in _TOKEN_RE.finditer(topic)]
    terms.extend(token for token in tokens if token and token not in _STOP_TOKENS)
    return _dedupe_strings(terms, limit=8)


def _domain_vault_queries(topic: str, domain: str) -> list[str]:
    lower = topic.lower()
    if domain == "league-of-legends" and any(keyword in lower for keyword in ("정글", "jungle")):
        return ["정글 동선", "라인 주도권", "오브젝트 운영", "시야 장악", "상대 정글 추적"]
    if domain == "python" and "컴프리헨션" in topic:
        return ["컴프리헨션", "표현식", "반복가능객체", "if 필터", "리스트 컴프리헨션", "딕셔너리 컴프리헨션"]
    return []


def _web_queries(topic: str, domain: str, intent: str, freshness: bool, vault_queries: list[str]) -> list[str]:
    queries: list[str] = []
    if domain == "league-of-legends" and any("정글" in query for query in [topic, *vault_queries]):
        queries.extend(
            [
                "리그오브레전드 정글 동선 최신",
                "LoL jungle pathing guide current patch",
                "리그오브레전드 정글 오브젝트 운영 라인 주도권",
            ]
        )
    elif domain == "python":
        queries.extend([topic, f"{topic} 공식 문서", f"{topic} 예제"])
    else:
        queries.extend([topic, f"{topic} {intent}", f"{topic} 개념 설명"])
    if freshness and not any("최신" in query or "current" in query.lower() for query in queries):
        queries.insert(0, f"{topic} 최신")
    return _dedupe_strings(queries, limit=5)


def _analyze_query(topic: str) -> dict[str, Any]:
    """Create the lightweight query plan used before web/context assembly."""

    raw_topic = re.sub(r"\s+", " ", str(topic or "")).strip()
    domain = _infer_domain(raw_topic)
    intent = _infer_intent(raw_topic)
    freshness = _freshness_required(raw_topic, domain)
    vault_queries = _dedupe_strings([*_domain_vault_queries(raw_topic, domain), *_topic_terms(raw_topic)], limit=10)
    return {
        "raw_topic": raw_topic,
        "domain": domain,
        "intent": intent,
        "freshness_required": freshness,
        "vault_queries": vault_queries,
        "web_queries": _web_queries(raw_topic, domain, intent, freshness, vault_queries),
    }


async def _search_from_query_plan(
    query_plan: dict[str, Any],
    settings: Settings,
    on_event: ProgressHandler | None,
) -> dict[str, Any]:
    queries = _dedupe_strings([str(query) for query in query_plan.get("web_queries", []) if str(query).strip()], limit=3)
    if not queries:
        queries = [str(query_plan.get("raw_topic") or "").strip()]
    results: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    backends: list[str] = []
    errors: list[dict[str, str]] = []

    for query in queries:
        await _emit_progress(on_event, "search_started", {"query": query, "limit": settings.search_limit})
        payload = await web_search(query, settings.search_limit)
        backend = str(payload.get("backend") or "")
        if backend:
            backends.append(backend)
        error = str(payload.get("error") or "")
        if error:
            errors.append({"query": query, "error": error})
        query_results = payload.get("results", [])
        if not isinstance(query_results, list):
            query_results = []
        await _emit_progress(
            on_event,
            "search_finished",
            {
                "query": query,
                "backend": backend,
                "count": len(query_results),
                "error": error or None,
            },
        )
        for item in query_results:
            if not isinstance(item, dict):
                continue
            url = str(item.get("url") or "").strip()
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            next_item = dict(item)
            next_item["query"] = query
            results.append(next_item)
            if len(results) >= settings.search_limit:
                break
        if len(results) >= settings.search_limit:
            break

    return {
        "backend": ",".join(_dedupe_strings(backends)) if backends else "none",
        "queries": queries,
        "results": results,
        "errors": errors,
    }


def _context_assembly_brief(
    pages: list[dict[str, Any]],
    fallback_sources: list[dict[str, Any]],
    query_plan: dict[str, Any],
) -> str:
    vault_hints = query_plan.get("vault_queries", [])
    if not isinstance(vault_hints, list):
        vault_hints = []
    return "\n\n".join(
        [
            "Query plan:\n" + json.dumps(query_plan, ensure_ascii=False, indent=2),
            "Vault context hints:\n" + "\n".join(f"- {hint}" for hint in vault_hints if str(hint).strip()),
            "External source material:\n" + _source_brief(pages, fallback_sources),
        ]
    )


def _semantic_sentences(raw: dict[str, Any]) -> list[tuple[str, str]]:
    sentences: list[tuple[str, str]] = []

    def add_text(heading: str, text: Any) -> None:
        for sentence in _SENTENCE_SPLIT_RE.split(str(text or "")):
            cleaned = re.sub(r"\s+", " ", sentence).strip()
            if cleaned:
                sentences.append((heading, cleaned))

    add_text("요약", raw.get("summary"))
    for item in raw.get("prerequisites") if isinstance(raw.get("prerequisites"), list) else []:
        add_text("선수 지식", item)
    for section in raw.get("sections") if isinstance(raw.get("sections"), list) else []:
        if not isinstance(section, dict):
            continue
        heading = str(section.get("title") or "본문")
        add_text(heading, section.get("content"))
        for lesson in section.get("lessons") if isinstance(section.get("lessons"), list) else []:
            if not isinstance(lesson, dict):
                continue
            add_text(heading, lesson.get("title"))
            add_text(heading, lesson.get("goal"))
    return sentences


def _tokens_for_candidates(text: str) -> list[str]:
    tokens: list[str] = []
    for match in _TOKEN_RE.finditer(text):
        token = _strip_particle(match.group(0))
        if token and token not in _STOP_TOKENS:
            tokens.append(token)
    return tokens


def _phrase_in_text(phrase: str, text: str) -> bool:
    if phrase in text:
        return True
    words = phrase.split()
    return bool(words) and all(word in text for word in words)


def _fallback_concepts(raw: dict[str, Any]) -> list[dict[str, Any]]:
    scores: Counter[str] = Counter()
    definitions: dict[str, str] = {}

    for section in raw.get("sections") if isinstance(raw.get("sections"), list) else []:
        if not isinstance(section, dict):
            continue
        diagram = str(section.get("diagram") or "")
        for match in _MERMAID_LABEL_RE.finditer(diagram):
            phrase = _clean_semantic_phrase(match.group(1))
            if phrase:
                scores[phrase] += 5

    for heading, sentence in _semantic_sentences(raw):
        tokens = _tokens_for_candidates(sentence)
        for size in (3, 2, 1):
            for index in range(0, max(len(tokens) - size + 1, 0)):
                phrase = _clean_semantic_phrase(" ".join(tokens[index : index + size]))
                if not phrase:
                    continue
                if size == 1 and scores[phrase] == 0:
                    continue
                scores[phrase] += size
                definitions.setdefault(phrase, sentence)
        for phrase in list(scores):
            if phrase not in definitions and _phrase_in_text(phrase, sentence):
                definitions[phrase] = sentence

    topic = _clean_semantic_phrase(raw.get("topic"))
    if topic and scores:
        for phrase in list(scores):
            if _phrase_in_text(phrase, topic):
                scores[phrase] += 2

    ranked = sorted(
        scores.items(),
        key=lambda item: (item[1], len(item[0].split()), len(item[0])),
        reverse=True,
    )
    concepts: list[dict[str, Any]] = []
    seen_parts: set[str] = set()
    for name, _score in ranked:
        if len(concepts) >= 8:
            break
        if any(name != existing and (name in existing or existing in name) for existing in seen_parts):
            continue
        seen_parts.add(name)
        concepts.append(
            {
                "id": f"concept_{hashlib.sha1(name.encode('utf-8')).hexdigest()[:12]}",
                "name": name,
                "aliases": [],
                "type": "candidate",
                "definition": definitions.get(name, ""),
            }
        )
    return concepts


def _fallback_mentions(raw: dict[str, Any], concepts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    mentions: list[dict[str, Any]] = []
    for concept in concepts:
        name = str(concept.get("name") or "").strip()
        if not name:
            continue
        for heading, sentence in _semantic_sentences(raw):
            if _phrase_in_text(name, sentence):
                mentions.append(
                    {
                        "text": name,
                        "concept_id": str(concept.get("id") or ""),
                        "heading": heading,
                        "confidence": 0.62,
                    }
                )
                break
    return mentions


def _infer_relation_type(sentence: str) -> str:
    if any(keyword in sentence for keyword in ("먼저", "전에", "필요", "요구", "있어야")):
        return "requires"
    if any(keyword in sentence for keyword in ("연결", "가능", "도와", "만들", "이어", "활용")):
        return "enables"
    return "related_to"


def _fallback_relations(raw: dict[str, Any], concepts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    relations: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for _heading, sentence in _semantic_sentences(raw):
        present = [concept for concept in concepts if _phrase_in_text(str(concept.get("name") or ""), sentence)]
        if len(present) < 2:
            continue
        for source, target in zip(present, present[1:]):
            source_name = str(source.get("name") or "")
            target_name = str(target.get("name") or "")
            relation_type = _infer_relation_type(sentence)
            key = (source_name, relation_type, target_name)
            if key in seen or source_name == target_name:
                continue
            seen.add(key)
            relations.append(
                {
                    "relation_id": _stable_relation_id(source_name, relation_type, target_name, sentence),
                    "source": source_name,
                    "relation_type": relation_type,
                    "target": target_name,
                    "evidence_text": sentence,
                    "confidence": 0.55,
                    "status": "candidate",
                }
            )
            if len(relations) >= 8:
                return relations
    return relations


def _normalize_curriculum(raw: dict[str, Any], topic: str, sources: list[dict[str, Any]]) -> dict[str, Any]:
    raw["topic"] = str(raw.get("topic") or topic)
    if not isinstance(raw.get("summary"), str):
        raw["summary"] = ""
    if not isinstance(raw.get("prerequisites"), list):
        raw["prerequisites"] = []
    if not isinstance(raw.get("sections"), list):
        raw["sections"] = []
    for section in raw["sections"]:
        if not isinstance(section, dict):
            continue
        if not isinstance(section.get("content"), str):
            section["content"] = ""
        if not isinstance(section.get("diagram"), str):
            section["diagram"] = ""
    raw["concepts"] = _normalize_concepts(raw.get("concepts"))
    if not raw["concepts"]:
        raw["concepts"] = _fallback_concepts(raw)
    raw["mentions"] = _normalize_mentions(raw.get("mentions"))
    if not raw["mentions"]:
        raw["mentions"] = _fallback_mentions(raw, raw["concepts"])
    raw["relations"] = _normalize_relations(raw.get("relations"))
    if not raw["relations"]:
        raw["relations"] = _fallback_relations(raw, raw["concepts"])
    raw["obsidian_aliases"] = _string_list(raw.get("obsidian_aliases"))
    raw["obsidian_tags"] = _string_list(raw.get("obsidian_tags"))
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
    query_plan = _analyze_query(topic)
    await _emit_progress(on_event, "query_analyzed", query_plan)
    search_payload = await _search_from_query_plan(query_plan, settings, on_event)
    search_results = search_payload.get("results", [])
    sources = search_results_to_sources(search_payload)
    selected_urls = [source["url"] for source in sources[: settings.extract_limit]]
    await _emit_progress(on_event, "extract_started", {"count": len(selected_urls), "urls": selected_urls})
    extract_payload = await web_extract(selected_urls) if selected_urls else {"pages": []}
    pages = extract_payload.get("pages", [])
    if not isinstance(pages, list):
        pages = []
    await _emit_progress(on_event, "extract_finished", {"count": len(pages)})

    prompt = f"""Topic: {topic}

{_context_assembly_brief(pages, sources, query_plan)}

Create a practical Korean study-note style curriculum for a learner.
Use the study-note-writer section order and include one Mermaid diagram per major section.
Return strict JSON matching the schema in the instructions.
"""
    await _emit_progress(on_event, "model_started", {"model": settings.codex_model})
    text = await codex_generate_text(
        prompt=prompt,
        instructions=_study_note_instructions(),
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
        "query_plan": query_plan,
    }
