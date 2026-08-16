import { createHash } from 'node:crypto';

export type SemanticNodeKind = 'document' | 'rule';

export type SemanticChunkInput = {
  id: string;
  text: string;
  ordinal: number;
  headingPath: string[];
};

export type SemanticNodeSegment = SemanticChunkInput & {
  pointId: string;
  ownerId: string;
  nodeId: string;
  nodeKind: SemanticNodeKind;
  documentId?: string;
  ruleId?: string;
  versionId: string;
  embeddingModel: string;
  segmentCount: number;
};

export type SemanticSegmentMatch = {
  source: SemanticNodeSegment;
  targetPointId: string;
  targetNodeId: string;
  targetNodeKind: SemanticNodeKind;
  targetDocumentId?: string;
  targetRuleId?: string;
  targetVersionId: string;
  targetChunkId: string;
  targetSegmentCount: number;
  rawScore: number;
};

export type SemanticLinkCandidate = {
  id: string;
  leftNodeId: string;
  rightNodeId: string;
  semanticScore: number;
  coverageScore: number;
  matchedPairCount: number;
  evidence: Array<{
    id: string;
    linkId: string;
    leftChunkId: string;
    rightChunkId: string;
    pairScore: number;
    ordinal: number;
  }>;
};

const MULTILINGUAL_E5_COSINE_BASELINE = 0.85;
export const MAX_SEMANTIC_NODE_SEGMENTS = 12;
export const MAX_SEMANTIC_LINKS_PER_NODE = 5;
const MAX_EVIDENCE_PAIRS = 3;
const SEMANTIC_PAIR_WEIGHT = 0.8;
const SEMANTIC_COVERAGE_WEIGHT = 0.2;

export function deterministicSemanticUuid(seed: string) {
  const bytes = Buffer.from(createHash('sha256').update(seed).digest('hex').slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function semanticNodeId(kind: SemanticNodeKind, sourceId: string) {
  return deterministicSemanticUuid(`semantic-node:${kind}:${sourceId}`);
}

export function semanticPointId(nodeId: string, chunkId: string) {
  return deterministicSemanticUuid(`semantic-point:${nodeId}:${chunkId}`);
}

export function canonicalSemanticNodePair(firstNodeId: string, secondNodeId: string) {
  if (!firstNodeId || !secondNodeId || firstNodeId === secondNodeId) return null;
  return firstNodeId < secondNodeId
    ? [firstNodeId, secondNodeId] as const
    : [secondNodeId, firstNodeId] as const;
}

export function semanticLinkId(firstNodeId: string, secondNodeId: string) {
  const pair = canonicalSemanticNodePair(firstNodeId, secondNodeId);
  return pair ? deterministicSemanticUuid(`semantic-link:${pair[0]}:${pair[1]}`) : null;
}

export function calibratedSemanticScore(rawScore: number, embeddingModel: string) {
  if (!embeddingModel.toLowerCase().includes('multilingual-e5')) {
    return Math.min(1, Math.max(0, rawScore));
  }
  return Math.min(1, Math.max(
    0,
    (rawScore - MULTILINGUAL_E5_COSINE_BASELINE) / (1 - MULTILINGUAL_E5_COSINE_BASELINE),
  ));
}

export function rawSemanticScoreThreshold(embeddingModel: string, configured: number) {
  return embeddingModel.toLowerCase().includes('multilingual-e5')
    ? MULTILINGUAL_E5_COSINE_BASELINE
      + (1 - MULTILINGUAL_E5_COSINE_BASELINE) * configured
    : configured;
}

export function semanticPairScoreFloor(finalScoreThreshold: number) {
  return Math.min(1, Math.max(
    0,
    (finalScoreThreshold - SEMANTIC_COVERAGE_WEIGHT) / SEMANTIC_PAIR_WEIGHT,
  ));
}

function addUnique(
  selected: SemanticChunkInput[],
  seen: Set<string>,
  chunk: SemanticChunkInput | undefined,
) {
  if (!chunk || seen.has(chunk.id) || selected.length >= MAX_SEMANTIC_NODE_SEGMENTS) return;
  seen.add(chunk.id);
  selected.push(chunk);
}

export function selectSemanticRepresentativeChunks(chunks: SemanticChunkInput[]) {
  const sorted = chunks
    .filter((chunk) => chunk.text.trim())
    .toSorted((left, right) => left.ordinal - right.ordinal);
  if (sorted.length <= MAX_SEMANTIC_NODE_SEGMENTS) return sorted;

  const selected: SemanticChunkInput[] = [];
  const seen = new Set<string>();
  addUnique(selected, seen, sorted[0]);
  addUnique(selected, seen, sorted.at(-1));

  const seenHeadings = new Set<string>();
  for (const chunk of sorted) {
    const heading = chunk.headingPath.map((item) => item.trim()).filter(Boolean).join(' › ');
    if (!heading || seenHeadings.has(heading)) continue;
    seenHeadings.add(heading);
    addUnique(selected, seen, chunk);
  }

  const remainingSlots = MAX_SEMANTIC_NODE_SEGMENTS - selected.length;
  for (let index = 1; index <= remainingSlots; index += 1) {
    const position = Math.round(index * (sorted.length - 1) / (remainingSlots + 1));
    addUnique(selected, seen, sorted[position]);
  }
  for (const chunk of sorted) addUnique(selected, seen, chunk);
  return selected.toSorted((left, right) => left.ordinal - right.ordinal);
}

export function semanticContentHash(chunks: SemanticChunkInput[]) {
  return createHash('sha256')
    .update(chunks.map((chunk) => `${chunk.id}:${chunk.text}`).join('\n'))
    .digest('hex');
}

export function aggregateSemanticLinkCandidates(
  sourceNodeId: string,
  sourceSegmentCount: number,
  embeddingModel: string,
  matches: SemanticSegmentMatch[],
  scoreThreshold: number,
) {
  const byTarget = new Map<string, SemanticSegmentMatch[]>();
  for (const match of matches) {
    if (!match.targetNodeId || match.targetNodeId === sourceNodeId) continue;
    byTarget.set(match.targetNodeId, [...(byTarget.get(match.targetNodeId) ?? []), match]);
  }

  const candidates: SemanticLinkCandidate[] = [];
  for (const [targetNodeId, targetMatches] of byTarget) {
    const selected: Array<SemanticSegmentMatch & { calibratedScore: number }> = [];
    const usedSourceChunks = new Set<string>();
    const usedTargetChunks = new Set<string>();
    const ranked = targetMatches
      .map((match) => ({
        ...match,
        calibratedScore: calibratedSemanticScore(match.rawScore, embeddingModel),
      }))
      .toSorted((left, right) => right.calibratedScore - left.calibratedScore);
    for (const match of ranked) {
      if (selected.length >= MAX_EVIDENCE_PAIRS) break;
      if (usedSourceChunks.has(match.source.id) || usedTargetChunks.has(match.targetChunkId)) continue;
      usedSourceChunks.add(match.source.id);
      usedTargetChunks.add(match.targetChunkId);
      selected.push(match);
    }
    if (!selected.length) continue;

    const requiredPairs = Math.max(1, Math.min(
      MAX_EVIDENCE_PAIRS,
      sourceSegmentCount,
      selected[0]?.targetSegmentCount ?? 1,
    ));
    const coverageScore = Math.min(1, selected.length / requiredPairs);
    const pairMean = selected.reduce((sum, match) => sum + match.calibratedScore, 0) / selected.length;
    const semanticScore = Math.min(1, Math.max(
      0,
      pairMean * SEMANTIC_PAIR_WEIGHT + coverageScore * SEMANTIC_COVERAGE_WEIGHT,
    ));
    if (semanticScore < scoreThreshold) continue;

    const pair = canonicalSemanticNodePair(sourceNodeId, targetNodeId);
    const id = semanticLinkId(sourceNodeId, targetNodeId);
    if (!pair || !id) continue;
    const sourceIsLeft = pair[0] === sourceNodeId;
    candidates.push({
      id,
      leftNodeId: pair[0],
      rightNodeId: pair[1],
      semanticScore,
      coverageScore,
      matchedPairCount: selected.length,
      evidence: selected.map((match, ordinal) => ({
        id: deterministicSemanticUuid(`semantic-evidence:${id}:${ordinal}`),
        linkId: id,
        leftChunkId: sourceIsLeft ? match.source.id : match.targetChunkId,
        rightChunkId: sourceIsLeft ? match.targetChunkId : match.source.id,
        pairScore: match.calibratedScore,
        ordinal,
      })),
    });
  }

  return candidates
    .toSorted((left, right) => right.semanticScore - left.semanticScore)
    .slice(0, MAX_SEMANTIC_LINKS_PER_NODE);
}
