from __future__ import annotations


TOOLSETS = {
    "sageum-agent": {
        "description": "Sageum curriculum worker tools",
        "tools": ["web_search", "web_extract"],
        "includes": [],
    },
    "web": {
        "description": "Web search and page extraction tools",
        "tools": ["web_search", "web_extract"],
        "includes": [],
    },
}


def get_toolset(name: str) -> dict | None:
    return TOOLSETS.get(name)


def get_all_toolsets() -> dict:
    return TOOLSETS.copy()


def validate_toolset(name: str) -> bool:
    return name in TOOLSETS


def resolve_toolset(name: str) -> list[str]:
    toolset = TOOLSETS.get(name)
    if not toolset:
        return []

    resolved: list[str] = []
    seen: set[str] = set()

    def add_tool(tool: str) -> None:
        if tool not in seen:
            seen.add(tool)
            resolved.append(tool)

    for included in toolset.get("includes", []):
        for tool in resolve_toolset(included):
            add_tool(tool)
    for tool in toolset.get("tools", []):
        add_tool(tool)

    return resolved
