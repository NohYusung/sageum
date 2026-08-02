from __future__ import annotations

import io
import asyncio
import json
import sys
import types
import unittest
from unittest.mock import patch

sys.modules.setdefault("httpx", types.SimpleNamespace(AsyncClient=object))

from sageum_agent.cli import main
from sageum_agent.contracts import JobResult
from sageum_agent.curriculum import _analyze_query, _normalize_curriculum, generate_curriculum
from sageum_agent.rendering import insert_wikilinks, render_obsidian_markdown
from sageum_agent.settings import Settings


SAMPLE_CURRICULUM = {
    "topic": "리그오브레전드 정글 잘하는 방법",
    "summary": "정글 판단은 동선, 라인 상태, 오브젝트 조건을 함께 보는 훈련이다.",
    "concepts": [
        {
            "id": "concept_jungle_pathing",
            "name": "정글 동선",
            "aliases": ["jungle pathing"],
            "type": "game_macro",
            "definition": "캠프와 갱킹 순서를 선택하는 판단 체계",
        },
        {
            "id": "concept_lane_priority",
            "name": "라인 주도권",
            "aliases": ["라인 프리오"],
            "type": "game_macro",
            "definition": "라인이 먼저 움직일 수 있는 상태",
        },
    ],
    "relations": [
        {
            "source": "라인 주도권",
            "relation_type": "enables",
            "target": "오브젝트 운영",
            "evidence_text": "라인 주도권이 있어야 오브젝트를 안전하게 시작한다.",
            "confidence": 0.82,
        }
    ],
    "obsidian_aliases": ["LoL 정글 가이드", "정글 잘하는 법"],
    "obsidian_tags": ["sageum/generated", "game/league-of-legends"],
    "sections": [
        {
            "title": "핵심 판단",
            "content": (
                "정글 동선은 초반 선택의 기준이다. 이미 연결된 [[라인 주도권]]은 중복 링크하지 않는다.\n\n"
                "```txt\n정글 동선은 코드 예시 안에서 링크하면 안 된다.\n```\n"
            ),
            "diagram": "flowchart TD\n  A[정글 동선] --> B[라인 주도권]",
            "lessons": [{"title": "첫 동선", "goal": "첫 캠프 선택 이유를 설명한다."}],
        }
    ],
    "sources": [{"title": "Riot patch notes", "url": "https://www.leagueoflegends.com/"}],
}


class ObsidianRenderingTest(unittest.TestCase):
    def test_render_obsidian_markdown_adds_frontmatter_and_safe_wikilinks(self) -> None:
        markdown = render_obsidian_markdown(SAMPLE_CURRICULUM)

        self.assertTrue(markdown.startswith("---\n"))
        self.assertIn("created_by: sageum-agent", markdown)
        self.assertIn("source_topic: 리그오브레전드 정글 잘하는 방법", markdown)
        self.assertIn('  - "[[정글 동선]]"', markdown)
        self.assertIn("  - LoL 정글 가이드", markdown)
        self.assertIn("  - sageum/generated", markdown)
        self.assertEqual(markdown.count("# 리그오브레전드 정글 잘하는 방법"), 1)
        self.assertIn("[[정글 동선]]은 초반 선택의 기준이다.", markdown)
        self.assertIn("[[라인 주도권]]은 중복 링크하지 않는다.", markdown)
        self.assertNotIn("[[[[라인 주도권]]]]", markdown)
        self.assertIn("```txt\n정글 동선은 코드 예시 안에서 링크하면 안 된다.\n```", markdown)
        self.assertIn("```mermaid\nflowchart TD\n  A[정글 동선] --> B[라인 주도권]\n```", markdown)
        self.assertIn("## 참고 링크", markdown)

    def test_insert_wikilinks_uses_alias_display_and_skips_existing_links(self) -> None:
        linked = insert_wikilinks(
            "라인 프리오와 [[라인 주도권]]을 같이 확인한다.",
            SAMPLE_CURRICULUM["concepts"],
        )

        self.assertIn("[[라인 주도권|라인 프리오]]", linked)
        self.assertIn("[[라인 주도권]]을 같이 확인한다.", linked)
        self.assertNotIn("[[[[라인 주도권]]]]", linked)

    def test_insert_wikilinks_links_each_concept_once_per_text_block(self) -> None:
        linked = insert_wikilinks(
            "정글 동선을 먼저 보고, 정글 동선이 바뀌면 다시 정글 동선을 점검한다.",
            SAMPLE_CURRICULUM["concepts"],
        )

        self.assertEqual(linked.count("[[정글 동선]]"), 1)
        self.assertIn("[[정글 동선]]을 먼저 보고, 정글 동선이 바뀌면 다시 정글 동선을 점검한다.", linked)

    def test_insert_wikilinks_skips_inline_code_and_nested_concept_links(self) -> None:
        linked = insert_wikilinks(
            "`표현식 for x in xs`와 조건 표현식을 비교한다.",
            [
                {"id": "concept_expression", "name": "표현식"},
                {"id": "concept_conditional_expression", "name": "조건 표현식"},
            ],
        )

        self.assertIn("`표현식 for x in xs`", linked)
        self.assertIn("[[조건 표현식]]을 비교한다.", linked)
        self.assertNotIn("[[조건 [[표현식]]]]", linked)
        self.assertNotIn("`[[표현식]] for x in xs`", linked)

    def test_cli_render_supports_obsidian_format(self) -> None:
        stdin = io.StringIO(json.dumps(SAMPLE_CURRICULUM, ensure_ascii=False))
        stdout = io.StringIO()

        with patch.object(sys, "stdin", stdin), patch.object(sys, "stdout", stdout):
            exit_code = main(["render", "--format", "obsidian"])

        self.assertEqual(exit_code, 0)
        payload = json.loads(stdout.getvalue())
        self.assertIn("markdown", payload)
        self.assertTrue(payload["markdown"].startswith("---\n"))
        self.assertIn("[[정글 동선]]", payload["markdown"])
        self.assertIn("html", payload)


class ObsidianContractsTest(unittest.TestCase):
    def test_completed_result_serializes_optional_semantic_metadata(self) -> None:
        result = JobResult.completed(
            job_id="job_123",
            markdown="# 문서\n",
            html="<article></article>\n",
            concepts=SAMPLE_CURRICULUM["concepts"],
            mentions=[{"text": "정글 동선", "concept_id": "concept_jungle_pathing"}],
            relations=SAMPLE_CURRICULUM["relations"],
            source_links=SAMPLE_CURRICULUM["sources"],
            suggested_filename="리그오브레전드 정글 잘하는 방법.md",
            obsidian_frontmatter={"type": "guide", "status": "generated"},
        )

        payload = result.to_payload()

        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["suggestedFilename"], "리그오브레전드 정글 잘하는 방법.md")
        self.assertEqual(payload["concepts"], SAMPLE_CURRICULUM["concepts"])
        self.assertEqual(payload["relations"], SAMPLE_CURRICULUM["relations"])
        self.assertEqual(payload["sourceLinks"], SAMPLE_CURRICULUM["sources"])
        self.assertEqual(payload["obsidianFrontmatter"]["status"], "generated")

    def test_normalized_relations_get_stable_relation_ids(self) -> None:
        first = _normalize_curriculum(dict(SAMPLE_CURRICULUM), SAMPLE_CURRICULUM["topic"], [])
        second = _normalize_curriculum(dict(SAMPLE_CURRICULUM), SAMPLE_CURRICULUM["topic"], [])

        self.assertTrue(first["relations"][0]["relation_id"].startswith("rel_"))
        self.assertEqual(first["relations"][0]["relation_id"], second["relations"][0]["relation_id"])
        self.assertEqual(first["relations"][0]["status"], "candidate")

    def test_normalize_curriculum_fills_semantic_metadata_when_model_omits_it(self) -> None:
        raw = {
            "topic": "리그오브레전드 정글 잘하는 방법",
            "summary": "정글러는 정글 동선, 라인 주도권, 오브젝트 운영을 함께 판단한다.",
            "sections": [
                {
                    "title": "핵심 개념",
                    "content": (
                        "정글 동선은 첫 캠프와 갱킹 순서를 정하는 기준이다. "
                        "드래곤은 라인 주도권과 시야 장악이 있어야 안전하게 시작할 수 있다. "
                        "오브젝트 운영은 라인 주도권과 시야 장악을 함께 요구한다."
                    ),
                    "diagram": (
                        "flowchart TD\n"
                        "  A[정글 동선] --> B[라인 주도권]\n"
                        "  B --> C[오브젝트 운영]\n"
                        "  B --> D[시야 장악]"
                    ),
                    "lessons": [{"title": "정글 동선", "goal": "라인 주도권을 확인한다."}],
                }
            ],
            "concepts": [],
            "mentions": [],
            "relations": [],
        }

        normalized = _normalize_curriculum(raw, raw["topic"], [])
        concept_names = {concept["name"] for concept in normalized["concepts"]}

        self.assertIn("정글 동선", concept_names)
        self.assertIn("라인 주도권", concept_names)
        self.assertIn("오브젝트 운영", concept_names)
        self.assertGreaterEqual(len(normalized["mentions"]), 3)
        self.assertTrue(any(relation["relation_id"].startswith("rel_") for relation in normalized["relations"]))

        markdown = render_obsidian_markdown(normalized)

        self.assertIn("[[정글 동선]]", markdown)
        self.assertIn("[[라인 주도권]]", markdown)
        self.assertIn("[[오브젝트 운영]]", markdown)


class QueryAnalyzerTest(unittest.TestCase):
    def test_query_analyzer_decomposes_lol_jungle_topic(self) -> None:
        plan = _analyze_query("리그오브레전드 정글 잘하는 방법")

        self.assertEqual(plan["raw_topic"], "리그오브레전드 정글 잘하는 방법")
        self.assertEqual(plan["domain"], "league-of-legends")
        self.assertEqual(plan["intent"], "how-to-guide")
        self.assertTrue(plan["freshness_required"])
        self.assertIn("정글 동선", plan["vault_queries"])
        self.assertIn("라인 주도권", plan["vault_queries"])
        self.assertIn("오브젝트 운영", plan["vault_queries"])
        self.assertIn("시야 장악", plan["vault_queries"])
        self.assertTrue(any("LoL jungle pathing" in query for query in plan["web_queries"]))

    def test_generate_curriculum_uses_query_plan_web_queries(self) -> None:
        topic = "리그오브레전드 정글 잘하는 방법"
        searched_queries: list[str] = []

        async def fake_web_search(query: str, limit: int) -> dict[str, object]:
            searched_queries.append(query)
            return {
                "backend": "fake",
                "results": [
                    {
                        "title": f"{query} source",
                        "url": f"https://example.com/{len(searched_queries)}",
                        "snippet": query,
                    }
                ],
            }

        async def fake_web_extract(urls: list[str]) -> dict[str, object]:
            return {
                "pages": [
                    {
                        "title": "LoL jungle page",
                        "url": urls[0],
                        "content": "정글 동선은 라인 주도권과 시야 장악을 보고 바뀐다.",
                    }
                ]
            }

        async def fake_codex_generate_text(*, prompt: str, instructions: str, model: str, settings: Settings) -> str:
            self.assertIn("Query plan:", prompt)
            self.assertIn("Vault context hints:", prompt)
            self.assertIn("정글 동선", prompt)
            return json.dumps(
                {
                    "topic": topic,
                    "summary": "정글 동선과 라인 주도권을 함께 판단한다.",
                    "sections": [
                        {
                            "title": "핵심 판단",
                            "content": "정글 동선은 라인 주도권과 시야 장악을 함께 본다.",
                            "diagram": "flowchart TD\nA[정글 동선] --> B[라인 주도권]",
                            "lessons": [],
                        }
                    ],
                    "concepts": [],
                    "mentions": [],
                    "relations": [],
                    "sources": [],
                },
                ensure_ascii=False,
            )

        settings = Settings(codex_model="test-model", search_limit=2, extract_limit=1)
        with (
            patch("sageum_agent.curriculum.web_search", side_effect=fake_web_search),
            patch("sageum_agent.curriculum.web_extract", side_effect=fake_web_extract),
            patch("sageum_agent.curriculum.codex_generate_text", side_effect=fake_codex_generate_text),
        ):
            generated = asyncio.run(generate_curriculum(topic, settings=settings))

        self.assertEqual(generated["query_plan"]["raw_topic"], topic)
        self.assertGreaterEqual(len(searched_queries), 2)
        self.assertTrue(any("정글 동선" in query for query in searched_queries))
        self.assertTrue(any("LoL jungle pathing" in query for query in searched_queries))


if __name__ == "__main__":
    unittest.main()
