from __future__ import annotations

from datetime import datetime, timezone
from html import escape
import hashlib
import re
from typing import Any, Mapping, Sequence


def _text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def _items(value: Any) -> Sequence[Any]:
    return value if isinstance(value, list) else []


def _mermaid(value: Any) -> str:
    text = _text(value).strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _slug_id(prefix: str, title: str) -> str:
    digest = hashlib.sha1(title.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}"


def _list_strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    strings: list[str] = []
    for item in value:
        text = _text(item).strip()
        if text:
            strings.append(text)
    return strings


def _concepts(value: Any) -> list[dict[str, Any]]:
    concepts: list[dict[str, Any]] = []
    for item in _items(value):
        if not isinstance(item, Mapping):
            continue
        name = _text(item.get("name")).strip()
        if not name:
            continue
        concepts.append(
            {
                "id": _text(item.get("id") or _slug_id("concept", name)),
                "name": name,
                "aliases": _list_strings(item.get("aliases")),
                "type": _text(item.get("type")),
                "definition": _text(item.get("definition")),
            }
        )
    return concepts


def _yaml_scalar(value: Any) -> str:
    text = _text(value).strip()
    if not text:
        return '""'
    if "\n" in text or text.startswith(("[", "{", "-", "#", "@", "!", "&", "*")) or ":" in text:
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


def _yaml_list(key: str, values: Sequence[str], *, quoted: bool = False) -> list[str]:
    lines = [f"{key}:"]
    if not values:
        lines.append("  []")
        return lines
    for value in values:
        item = '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"' if quoted else _yaml_scalar(value)
        lines.append(f"  - {item}")
    return lines


def render_obsidian_frontmatter(curriculum: Mapping[str, Any]) -> str:
    """Render Obsidian-compatible YAML frontmatter for a generated note."""

    topic = _text(curriculum.get("topic") or curriculum.get("title"), "Untitled curriculum")
    sageum_id = _text(curriculum.get("sageum_id") or _slug_id("doc", topic))
    created_at = _text(curriculum.get("created_at")) or datetime.now(timezone.utc).isoformat()
    updated_at = _text(curriculum.get("updated_at")) or created_at
    concepts = [f"[[{concept['name']}]]" for concept in _concepts(curriculum.get("concepts"))]
    aliases = _list_strings(curriculum.get("obsidian_aliases") or curriculum.get("aliases"))
    tags = _list_strings(curriculum.get("obsidian_tags") or curriculum.get("tags")) or ["sageum/generated"]

    lines = [
        "---",
        f"sageum_id: {_yaml_scalar(sageum_id)}",
        f"type: {_yaml_scalar(curriculum.get('type') or curriculum.get('obsidian_type') or 'guide')}",
        f"status: {_yaml_scalar(curriculum.get('status') or 'generated')}",
        "created_by: sageum-agent",
        f"created_at: {_yaml_scalar(created_at)}",
        f"updated_at: {_yaml_scalar(updated_at)}",
        f"source_topic: {_yaml_scalar(topic)}",
    ]
    domain = _text(curriculum.get("domain")).strip()
    if domain:
        lines.append(f"domain: {_yaml_scalar(domain)}")
    lines.extend(_yaml_list("aliases", aliases))
    lines.extend(_yaml_list("concepts", concepts, quoted=True))
    lines.extend(_yaml_list("tags", tags))
    lines.append("---")
    return "\n".join(lines) + "\n"


def _link_segment(segment: str, concepts: Sequence[dict[str, Any]], linked_targets: set[str]) -> str:
    terms: list[tuple[str, str]] = []
    for concept in concepts:
        name = _text(concept.get("name")).strip()
        if not name:
            continue
        terms.append((name, name))
        for alias in _list_strings(concept.get("aliases")):
            terms.append((alias, name))
    terms.sort(key=lambda item: len(item[0]), reverse=True)

    linked = segment
    for display, target in terms:
        if not display or target in linked_targets:
            continue
        link = f"[[{target}]]" if display == target else f"[[{target}|{display}]]"
        next_linked, changed = _replace_first_plain_text(linked, display, link)
        if changed:
            linked_targets.add(target)
            linked = next_linked
    return linked


def _replace_first_plain_text(text: str, display: str, replacement: str) -> tuple[str, bool]:
    parts = re.split(r"(`[^`]*`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\))", text)
    for index, part in enumerate(parts):
        if (
            part.startswith("`")
            or (part.startswith("[[") and part.endswith("]]"))
            or re.match(r"^\[[^\]]+\]\([^)]+\)$", part)
        ):
            continue
        next_part = re.sub(re.escape(display), replacement, part, count=1)
        if next_part != part:
            parts[index] = next_part
            return "".join(parts), True
    return text, False


def _link_line(line: str, concepts: Sequence[dict[str, Any]], linked_targets: set[str]) -> str:
    parts = re.split(r"(`[^`]*`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\))", line)
    rendered: list[str] = []
    for part in parts:
        if part.startswith("[[") and part.endswith("]]"):
            target = part[2:-2].split("|", 1)[0].strip()
            if target:
                linked_targets.add(target)
            rendered.append(part)
        elif (
            part.startswith("`")
            or re.match(r"^\[[^\]]+\]\([^)]+\)$", part)
        ):
            rendered.append(part)
        else:
            rendered.append(_link_segment(part, concepts, linked_targets))
    return "".join(rendered)


def insert_wikilinks(text: str, concepts: Sequence[Mapping[str, Any]]) -> str:
    """Insert Obsidian wikilinks while leaving existing links and code fences intact."""

    normalized = _concepts(list(concepts))
    if not normalized or not text:
        return text

    result: list[str] = []
    in_code = False
    linked_targets: set[str] = set()
    for line in text.splitlines(keepends=True):
        stripped = line.lstrip()
        if stripped.startswith("```"):
            in_code = not in_code
            result.append(line)
            continue
        result.append(line if in_code else _link_line(line, normalized, linked_targets))
    return "".join(result)


def render_obsidian_markdown(curriculum: Mapping[str, Any]) -> str:
    """Render the stable curriculum schema to Obsidian-compatible markdown."""

    topic = _text(curriculum.get("topic") or curriculum.get("title"), "Untitled curriculum")
    concepts = _concepts(curriculum.get("concepts"))
    summary = insert_wikilinks(_text(curriculum.get("summary")).strip(), concepts)
    lines: list[str] = [render_obsidian_frontmatter(curriculum).strip(), "", f"# {topic}", ""]

    if summary:
        lines.extend([summary, ""])

    prerequisites = _items(curriculum.get("prerequisites"))
    if prerequisites:
        lines.extend(["## 선수 지식", ""])
        lines.extend(f"- {insert_wikilinks(_text(item), concepts)}" for item in prerequisites)
        lines.append("")

    for section in _items(curriculum.get("sections")):
        if not isinstance(section, Mapping):
            continue
        title = _text(section.get("title"), "Section")
        lines.extend([f"## {title}", ""])
        content = insert_wikilinks(_text(section.get("content")).strip(), concepts)
        if content:
            lines.extend([content, ""])
        diagram = _mermaid(section.get("diagram"))
        if diagram:
            lines.extend(["```mermaid", diagram, "```", ""])
        for index, lesson in enumerate(_items(section.get("lessons")), start=1):
            if not isinstance(lesson, Mapping):
                continue
            lesson_title = _text(lesson.get("title"), f"Lesson {index}")
            goal = insert_wikilinks(_text(lesson.get("goal")), concepts)
            if goal:
                lines.append(f"{index}. **{lesson_title}**: {goal}")
            else:
                lines.append(f"{index}. **{lesson_title}**")
        lines.append("")

    sources = _items(curriculum.get("sources"))
    if sources:
        lines.extend(["## 참고 링크", ""])
        for source in sources:
            if not isinstance(source, Mapping):
                continue
            title = _text(source.get("title"), "Source")
            url = _text(source.get("url"))
            lines.append(f"- [{title}]({url})" if url else f"- {title}")
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def render_markdown(curriculum: Mapping[str, Any]) -> str:
    """Render the stable curriculum schema to markdown."""

    topic = _text(curriculum.get("topic"), "Untitled curriculum")
    summary = _text(curriculum.get("summary"))
    lines: list[str] = [f"# {topic}", ""]

    if summary:
        lines.extend([summary, ""])

    prerequisites = _items(curriculum.get("prerequisites"))
    if prerequisites:
        lines.extend(["## 선수 지식", ""])
        lines.extend(f"- {_text(item)}" for item in prerequisites)
        lines.append("")

    for section in _items(curriculum.get("sections")):
        if not isinstance(section, Mapping):
            continue
        title = _text(section.get("title"), "Section")
        lines.extend([f"## {title}", ""])
        content = _text(section.get("content")).strip()
        if content:
            lines.extend([content, ""])
        diagram = _mermaid(section.get("diagram"))
        if diagram:
            lines.extend(["```mermaid", diagram, "```", ""])
        for index, lesson in enumerate(_items(section.get("lessons")), start=1):
            if not isinstance(lesson, Mapping):
                continue
            lesson_title = _text(lesson.get("title"), f"Lesson {index}")
            goal = _text(lesson.get("goal"))
            if goal:
                lines.append(f"{index}. **{lesson_title}**: {goal}")
            else:
                lines.append(f"{index}. **{lesson_title}**")
        lines.append("")

    sources = _items(curriculum.get("sources"))
    if sources:
        lines.extend(["## 참고 링크", ""])
        for source in sources:
            if not isinstance(source, Mapping):
                continue
            title = _text(source.get("title"), "Source")
            url = _text(source.get("url"))
            lines.append(f"- [{title}]({url})" if url else f"- {title}")
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def render_html(curriculum: Mapping[str, Any]) -> str:
    """Render curriculum HTML with escaping at every generated boundary."""

    topic = escape(_text(curriculum.get("topic"), "Untitled curriculum"))
    summary = escape(_text(curriculum.get("summary")))
    parts: list[str] = [
        '<article class="sageum-curriculum">',
        f"  <header><h1>{topic}</h1></header>",
    ]

    if summary:
        parts.append(f'  <p class="summary">{summary}</p>')

    prerequisites = _items(curriculum.get("prerequisites"))
    if prerequisites:
        parts.append('  <section class="prerequisites"><h2>선수 지식</h2><ul>')
        for item in prerequisites:
            parts.append(f"    <li>{escape(_text(item))}</li>")
        parts.append("  </ul></section>")

    for section in _items(curriculum.get("sections")):
        if not isinstance(section, Mapping):
            continue
        title = escape(_text(section.get("title"), "Section"))
        parts.append(f'  <section class="curriculum-section"><h2>{title}</h2>')
        content = _text(section.get("content")).strip()
        if content:
            parts.append(f'    <p class="section-content">{escape(content)}</p>')
        diagram = _mermaid(section.get("diagram"))
        if diagram:
            parts.append(f'    <pre class="mermaid">{escape(diagram)}</pre>')
        parts.append("    <ol>")
        for lesson in _items(section.get("lessons")):
            if not isinstance(lesson, Mapping):
                continue
            lesson_title = escape(_text(lesson.get("title"), "Lesson"))
            goal = escape(_text(lesson.get("goal")))
            if goal:
                parts.append(f"    <li><strong>{lesson_title}</strong><p>{goal}</p></li>")
            else:
                parts.append(f"    <li><strong>{lesson_title}</strong></li>")
        parts.append("    </ol>")
        parts.append("  </section>")

    sources = _items(curriculum.get("sources"))
    if sources:
        parts.append('  <section class="sources"><h2>참고 링크</h2><ul>')
        for source in sources:
            if not isinstance(source, Mapping):
                continue
            title = escape(_text(source.get("title"), "Source"))
            url = escape(_text(source.get("url")), quote=True)
            if url:
                parts.append(f'    <li><a href="{url}" rel="noreferrer">{title}</a></li>')
            else:
                parts.append(f"    <li>{title}</li>")
        parts.append("  </ul></section>")

    parts.append("</article>")
    return "\n".join(parts) + "\n"
