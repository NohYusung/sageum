export const DOCUMENT_STRUCTURE_PANE_DEFAULT_WIDTH = 300;
export const DOCUMENT_STRUCTURE_PANE_MIN_WIDTH = 220;
export const DOCUMENT_PREVIEW_PANE_MIN_WIDTH = 360;
export const DOCUMENT_COMPARISON_SEPARATOR_WIDTH = 14;
export const DOCUMENT_COMPARISON_NARROW_WIDTH = 680;
export const DOCUMENT_STRUCTURE_PANE_MAX_RATIO = 0.45;

export function isDocumentComparisonNarrow(width: number) {
  return width < DOCUMENT_COMPARISON_NARROW_WIDTH;
}

export function documentStructurePaneWidthBounds(width: number) {
  const availableWidth = Math.max(0, width);
  const maximum = Math.max(
    DOCUMENT_STRUCTURE_PANE_MIN_WIDTH,
    Math.min(
      Math.floor(availableWidth * DOCUMENT_STRUCTURE_PANE_MAX_RATIO),
      availableWidth
        - DOCUMENT_PREVIEW_PANE_MIN_WIDTH
        - DOCUMENT_COMPARISON_SEPARATOR_WIDTH,
    ),
  );
  return {
    minimum: DOCUMENT_STRUCTURE_PANE_MIN_WIDTH,
    maximum,
  };
}

export function resolveDocumentStructurePaneWidth(
  comparisonWidth: number,
  requestedWidth: number,
) {
  const { minimum, maximum } = documentStructurePaneWidthBounds(comparisonWidth);
  const width = Number.isFinite(requestedWidth)
    ? requestedWidth
    : DOCUMENT_STRUCTURE_PANE_DEFAULT_WIDTH;
  return Math.min(Math.max(width, minimum), maximum);
}
