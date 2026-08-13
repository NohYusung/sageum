export type ExactTextSpan = {
  text: string;
  startOffset: number;
  endOffset: number;
};

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function variants(value: string) {
  return Array.from(new Set([
    value,
    value.normalize('NFC'),
    value.normalize('NFD'),
  ].filter(Boolean)));
}

export function findExactTextSpan(text: string, phrase: string): ExactTextSpan | null {
  const trimmed = phrase.trim();
  if (!trimmed) return null;

  for (const candidate of variants(trimmed)) {
    const directIndex = text.indexOf(candidate);
    if (directIndex >= 0) {
      return {
        text: text.slice(directIndex, directIndex + candidate.length),
        startOffset: directIndex,
        endOffset: directIndex + candidate.length,
      };
    }

    const parts = candidate.split(/\s+/u).filter(Boolean);
    if (parts.length < 2) continue;
    const pattern = parts.map(escaped).join('\\s+');
    const match = new RegExp(pattern, 'u').exec(text);
    if (!match || match.index < 0) continue;
    return {
      text: match[0],
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    };
  }
  return null;
}
