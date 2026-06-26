from __future__ import annotations

from html import escape
from typing import Any, Mapping, Sequence


def _text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def _items(value: Any) -> Sequence[Any]:
    return value if isinstance(value, list) else []


def render_markdown(curriculum: Mapping[str, Any]) -> str:
    """Render the stable curriculum schema to markdown."""

    topic = _text(curriculum.get("topic"), "Untitled curriculum")
    summary = _text(curriculum.get("summary"))
    lines: list[str] = [f"# {topic}", ""]

    if summary:
        lines.extend([summary, ""])

    prerequisites = _items(curriculum.get("prerequisites"))
    if prerequisites:
        lines.extend(["## Prerequisites", ""])
        lines.extend(f"- {_text(item)}" for item in prerequisites)
        lines.append("")

    for section in _items(curriculum.get("sections")):
        if not isinstance(section, Mapping):
            continue
        title = _text(section.get("title"), "Section")
        lines.extend([f"## {title}", ""])
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
        lines.extend(["## Sources", ""])
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
        parts.append('  <section class="prerequisites"><h2>Prerequisites</h2><ul>')
        for item in prerequisites:
            parts.append(f"    <li>{escape(_text(item))}</li>")
        parts.append("  </ul></section>")

    for section in _items(curriculum.get("sections")):
        if not isinstance(section, Mapping):
            continue
        title = escape(_text(section.get("title"), "Section"))
        parts.append(f'  <section class="curriculum-section"><h2>{title}</h2><ol>')
        for lesson in _items(section.get("lessons")):
            if not isinstance(lesson, Mapping):
                continue
            lesson_title = escape(_text(lesson.get("title"), "Lesson"))
            goal = escape(_text(lesson.get("goal")))
            if goal:
                parts.append(f"    <li><strong>{lesson_title}</strong><p>{goal}</p></li>")
            else:
                parts.append(f"    <li><strong>{lesson_title}</strong></li>")
        parts.append("  </ol></section>")

    sources = _items(curriculum.get("sources"))
    if sources:
        parts.append('  <section class="sources"><h2>Sources</h2><ul>')
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
