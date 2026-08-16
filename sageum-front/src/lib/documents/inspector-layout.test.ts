import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DOCUMENT_COMPARISON_NARROW_WIDTH,
  DOCUMENT_COMPARISON_SEPARATOR_WIDTH,
  DOCUMENT_PREVIEW_PANE_MIN_WIDTH,
  DOCUMENT_STRUCTURE_PANE_DEFAULT_WIDTH,
  DOCUMENT_STRUCTURE_PANE_MIN_WIDTH,
  documentStructurePaneWidthBounds,
  isDocumentComparisonNarrow,
  resolveDocumentStructurePaneWidth,
} from './inspector-layout';

test('구조화 결과 영역은 기본 폭과 최소 폭을 유지한다', () => {
  assert.equal(
    resolveDocumentStructurePaneWidth(900, DOCUMENT_STRUCTURE_PANE_DEFAULT_WIDTH),
    DOCUMENT_STRUCTURE_PANE_DEFAULT_WIDTH,
  );
  assert.equal(
    resolveDocumentStructurePaneWidth(900, 100),
    DOCUMENT_STRUCTURE_PANE_MIN_WIDTH,
  );
});

test('구조화 결과 영역을 넓혀도 원본 미리보기 최소 폭을 보장한다', () => {
  const comparisonWidth = 700;
  const { maximum } = documentStructurePaneWidthBounds(comparisonWidth);
  const resolved = resolveDocumentStructurePaneWidth(comparisonWidth, 900);

  assert.equal(resolved, maximum);
  assert.ok(
    comparisonWidth - resolved - DOCUMENT_COMPARISON_SEPARATOR_WIDTH >=
      DOCUMENT_PREVIEW_PANE_MIN_WIDTH,
  );
});

test('비교 영역의 좁은 화면 전환 기준은 680px이다', () => {
  assert.equal(isDocumentComparisonNarrow(DOCUMENT_COMPARISON_NARROW_WIDTH - 1), true);
  assert.equal(isDocumentComparisonNarrow(DOCUMENT_COMPARISON_NARROW_WIDTH), false);
});
