import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openVaultDatabase, VaultIndexerService } from '../src/vault/vault-indexer.service';
import { VaultPathService } from '../src/vault/vault-path.service';
import { VaultRelationReviewService } from '../src/vault/vault-relation-review.service';
import { VaultSearchService } from '../src/vault/vault-search.service';
import { VaultController } from '../src/vault/vault.controller';
import { VaultService } from '../src/vault/vault.service';

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'sageum-vault-'));
  try {
    const paths = new VaultPathService({
      vaultRoot: root,
      noteRoot: '10_Notes',
      conceptRoot: '20_Concepts',
      sourceRoot: '30_Sources',
      mapRoot: '40_Maps',
      indexPath: '.sageum/index.sqlite',
    });
    const service = new VaultService(paths);

    assert.throws(() => paths.resolveInside('../escape.md'), /outside vault root/i);

    const first = await service.saveDocument({
      jobId: 'job_123',
      title: '리그오브레전드 정글 잘하는 방법',
      markdown: '# 리그오브레전드 정글 잘하는 방법\n\n정글 동선과 라인 주도권을 본다.\n',
      concepts: [
        {
          id: 'concept_jungle_pathing',
          name: '정글 동선',
          aliases: ['jungle pathing'],
          type: 'game_macro',
          definition: '초반 캠프와 갱킹 순서를 정하는 판단 체계',
        },
      ],
      mentions: [{ text: '정글 동선', concept_id: 'concept_jungle_pathing' }],
      relations: [
        {
          source: 'concept_jungle_pathing',
          relation_type: 'supports',
          target: 'concept_lane_priority',
          evidence_text: '정글 동선과 라인 주도권을 본다.',
          confidence: 0.81,
        },
      ],
      sources: [{ title: 'Riot', url: 'https://www.leagueoflegends.com/' }],
      options: { createConceptNotes: true },
    });

    assert.equal(first.path, '10_Notes/리그오브레전드 정글 잘하는 방법.md');
    assert.equal(first.createdConcepts[0], '20_Concepts/정글 동선.md');
    assert.ok(first.sidecars.includes(`.sageum/annotations/${first.documentId}.json`));
    assert.ok(first.sidecars.includes(`.sageum/relations/${first.documentId}.json`));
    assert.ok(existsSync(join(root, first.path)));
    assert.ok(existsSync(join(root, '20_Concepts/정글 동선.md')));
    assert.ok(existsSync(join(root, '.sageum/manifest.json')));

    const markdown = readFileSync(join(root, first.path), 'utf8');
    assert.match(markdown, /^---\nsageum_id: doc_/);
    assert.match(markdown, /created_by: sageum-agent/);
    assert.match(markdown, /# 리그오브레전드 정글 잘하는 방법/);

    const existingFrontmatter = await service.saveDocument({
      title: '기존 Frontmatter 문서',
      markdown: [
        '---',
        'sageum_id: doc_existing_frontmatter',
        'type: guide',
        'status: generated',
        '---',
        '',
        '# 기존 Frontmatter 문서',
        '',
        '이미 frontmatter가 있는 문서다.',
        '',
      ].join('\n'),
      concepts: [],
      relations: [],
      sources: [],
      options: { createConceptNotes: false },
    });
    const existingFrontmatterMarkdown = readFileSync(join(root, existingFrontmatter.path), 'utf8');
    assert.equal(existingFrontmatter.documentId, 'doc_existing_frontmatter');
    assert.equal(existingFrontmatterMarkdown.match(/^sageum_id:/gm)?.length, 1);

    const annotation = JSON.parse(readFileSync(join(root, `.sageum/annotations/${first.documentId}.json`), 'utf8'));
    assert.equal(annotation.document_id, first.documentId);
    assert.equal(annotation.file, first.path);
    assert.equal(annotation.mentions[0].text, '정글 동선');

    const relation = JSON.parse(readFileSync(join(root, `.sageum/relations/${first.documentId}.json`), 'utf8'));
    assert.equal(relation.document_id, first.documentId);
    assert.equal(relation.relations[0].status, 'candidate');

    const second = await service.saveDocument({
      title: '리그오브레전드 정글 잘하는 방법',
      markdown: '# 두 번째 문서\n',
      concepts: [],
      relations: [],
      sources: [],
      options: { createConceptNotes: false },
    });

    assert.equal(second.path, '10_Notes/리그오브레전드 정글 잘하는 방법 2.md');

    await service.saveDocument({
      title: '드래곤 판단 조건',
      markdown: '# 드래곤 판단 조건\n\n용은 오브젝트 운영, 라인 주도권, 시야 장악 조건을 보고 먹는다.\n',
      concepts: [
        { id: 'concept_dragon', name: '드래곤', aliases: ['용'] },
        { id: 'concept_objective_control', name: '오브젝트 운영', aliases: [] },
        { id: 'concept_lane_priority', name: '라인 주도권', aliases: [] },
        { id: 'concept_vision_control', name: '시야 장악', aliases: [] },
      ],
      relations: [
        {
          relation_id: 'rel_dragon_requires_objective',
          source: 'concept_dragon',
          relation_type: 'requires',
          target: 'concept_objective_control',
          evidence_text: '용은 오브젝트 운영 조건을 보고 먹는다.',
          confidence: 0.9,
        },
        {
          source: 'concept_objective_control',
          relation_type: 'requires',
          target: 'concept_lane_priority',
          evidence_text: '오브젝트 운영은 라인 주도권을 보고 판단한다.',
          confidence: 0.85,
        },
        {
          source: 'concept_objective_control',
          relation_type: 'requires',
          target: 'concept_vision_control',
          evidence_text: '오브젝트 운영은 시야 장악을 보고 판단한다.',
          confidence: 0.83,
        },
      ],
      sources: [],
      options: { createConceptNotes: true },
    });

    const duplicateAlias = await service.saveDocument({
      title: '용 판단 복습',
      markdown: '# 용 판단 복습\n\n용은 드래곤과 같은 concept alias다.\n',
      concepts: [{ id: 'concept_duplicate_dragon', name: '용', aliases: ['dragon'] }],
      relations: [],
      sources: [],
      options: { createConceptNotes: true },
    });
    assert.equal(duplicateAlias.createdConcepts.length, 0);
    assert.equal(existsSync(join(root, '20_Concepts/용.md')), false);

    writeFileSync(
      join(root, 'noisy-root-reference.md'),
      '# 드래곤 판단 조건\n\n용 언제 먹어야 해 드래곤 오브젝트 운영 라인 주도권 시야 장악\n',
      'utf8',
    );
    await service.saveDocument({
      title: '중복 링크 문서',
      markdown: '# 중복 링크 문서\n\n[[드래곤]]과 [[드래곤]]은 같은 block에서 반복될 수 있다.\n',
      concepts: [],
      relations: [],
      sources: [],
      options: { createConceptNotes: false },
    });
    await service.saveDocument({
      title: '무관한 노트',
      markdown: '# 무관한 노트\n\n이 문서는 사용법과 적용 예시를 다루지만 검색 의도와 직접 관련 없는 별도 노트다.\n',
      concepts: [],
      relations: [],
      sources: [],
      options: { createConceptNotes: false },
    });
    const codeBlockDocument = await service.saveDocument({
      title: '코드 블록 문서',
      markdown: [
        '# 코드 블록 문서',
        '',
        '```md',
        '# 코드 내부 제목',
        '[[드래곤]]은 코드 예시 안의 텍스트다.',
        '```',
        '',
      ].join('\n'),
      concepts: [],
      relations: [],
      sources: [],
      options: { createConceptNotes: false },
    });

    const indexer = new VaultIndexerService(paths);
    const status = await indexer.rebuild();
    assert.ok(status.documentCount >= 3);
    assert.ok(status.conceptCount >= 4);
    assert.ok(status.relationCount >= 3, JSON.stringify(status));
    assert.ok(existsSync(join(root, '.sageum/index.sqlite')));

    writeFileSync(
      join(root, '.sageum/annotations/stale.json'),
      `${JSON.stringify({ document_id: 'doc_missing', mentions: [{ text: '없는 문서', concept_id: 'concept_missing' }] }, null, 2)}\n`,
      'utf8',
    );
    const rebuilt = await indexer.rebuild();
    assert.ok(rebuilt.documentCount >= status.documentCount);

    const db = openVaultDatabase(paths);
    try {
      const codeBlocks = db
        .prepare(
          `SELECT document_blocks.block_type, document_blocks.heading_path, document_blocks.text
           FROM document_blocks
           INNER JOIN documents ON documents.id = document_blocks.document_id
           WHERE documents.path = ?`,
        )
        .all(codeBlockDocument.path) as Array<{ block_type: string; heading_path: string; text: string }>;
      assert.equal(codeBlocks.length, 1);
      assert.equal(codeBlocks[0].block_type, 'code');
      assert.equal(codeBlocks[0].heading_path, '코드 블록 문서');
      assert.match(codeBlocks[0].text, /\[\[드래곤\]\]/);
      const codeWikilinks = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM wikilinks
           INNER JOIN documents ON documents.id = wikilinks.source_document_id
           WHERE documents.path = ?`,
        )
        .get(codeBlockDocument.path) as { count: number };
      assert.equal(Number(codeWikilinks.count), 0);
    } finally {
      db.close();
    }

    const search = new VaultSearchService(paths);
    const found = await search.search('용 언제 먹어야 해?');
    assert.equal(found.query, '용 언제 먹어야 해?');
    assert.equal(found.matchedConcepts[0].name, '드래곤');
    assert.equal(found.matchedConcepts[0].matchedBy, 'alias');
    assert.ok(found.expandedConcepts.includes('오브젝트 운영'));
    assert.ok(found.expandedConcepts.includes('라인 주도권'));
    assert.ok(found.expandedConcepts.includes('시야 장악'));
    assert.ok(found.results.some((result) => result.path === '10_Notes/드래곤 판단 조건.md'));
    assert.ok(found.results.some((result) => result.type === 'document' && result.documentTitle === '드래곤 판단 조건'));
    assert.ok(found.results.some((result) => result.type === 'concept' && result.documentTitle === '드래곤'));
    assert.ok(!found.results.some((result) => result.path === '10_Notes/무관한 노트.md'));
    const noteRank = found.results.findIndex((result) => result.path === '10_Notes/드래곤 판단 조건.md');
    const noisyRank = found.results.findIndex((result) => result.path === 'noisy-root-reference.md');
    assert.ok(noteRank >= 0);
    assert.ok(noisyRank >= 0);
    assert.ok(noteRank < noisyRank, `note rank ${noteRank} should beat noisy root rank ${noisyRank}`);

    const partialConceptSearch = await search.search('드래 언제');
    assert.ok(
      partialConceptSearch.matchedConcepts.some((concept) => concept.name === '드래곤' && concept.matchedBy === 'name'),
      JSON.stringify(partialConceptSearch.matchedConcepts),
    );

    const candidateObjectiveScore =
      found.results.find((result) => result.path === '10_Notes/드래곤 판단 조건.md')?.score ?? 0;
    const reviewer = new VaultRelationReviewService(paths);
    const approved = await reviewer.approve('rel_dragon_requires_objective');
    assert.equal(approved.status, 'approved');
    assert.equal(approved.relationId, 'rel_dragon_requires_objective');

    const approvedSearch = await search.search('용 언제 먹어야 해?');
    const approvedObjectiveScore =
      approvedSearch.results.find((result) => result.path === '10_Notes/드래곤 판단 조건.md')?.score ?? 0;
    assert.ok(
      approvedObjectiveScore > candidateObjectiveScore,
      `approved score ${approvedObjectiveScore} should exceed candidate score ${candidateObjectiveScore}`,
    );

    const approvedSidecar = JSON.parse(readFileSync(join(root, `.sageum/relations/${approved.documentId}.json`), 'utf8'));
    assert.equal(
      approvedSidecar.relations.find((item: Record<string, unknown>) => item.relation_id === 'rel_dragon_requires_objective')?.status,
      'approved',
    );

    const rejected = await reviewer.reject('rel_dragon_requires_objective');
    assert.equal(rejected.status, 'rejected');
    const rejectedSearch = await search.search('용 언제 먹어야 해?');
    assert.ok(!rejectedSearch.expandedConcepts.includes('오브젝트 운영'));
    assert.ok(!rejectedSearch.expandedConcepts.includes('라인 주도권'));
    assert.ok(!rejectedSearch.expandedConcepts.includes('시야 장악'));

    const controller = new VaultController(service, indexer, search, reviewer);
    const savedThroughController = await controller.saveDocument({
      title: '컨트롤러 저장 인덱스 갱신',
      markdown: '# 컨트롤러 저장 인덱스 갱신\n\n저장 API는 파일 저장 후 index를 갱신한다.\n',
      concepts: [],
      relations: [],
      sources: [],
      options: { createConceptNotes: false },
    });
    assert.equal(savedThroughController.path, '10_Notes/컨트롤러 저장 인덱스 갱신.md');
    assert.ok(savedThroughController.index.documentCount >= rebuilt.documentCount);
    const indexedControllerNote = await search.search('컨트롤러 저장 인덱스 갱신');
    assert.ok(indexedControllerNote.results.some((result) => result.path === savedThroughController.path));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
