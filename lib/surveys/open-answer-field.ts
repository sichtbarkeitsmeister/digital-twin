/** Open-question answer fields grow with wrapped text up to this many lines, then scroll. */
export const OPEN_ANSWER_MAX_ROWS = 3;

export function measureOpenAnswerHeight(input: {
  scrollHeight: number;
  lineHeight: number;
  paddingY: number;
  cssMinHeight?: number;
  cssMaxHeight?: number;
  maxRows?: number;
}): { height: number; overflowY: "hidden" | "auto" } {
  const lineHeight = Number.isFinite(input.lineHeight) && input.lineHeight > 0 ? input.lineHeight : 20;
  const paddingY = Number.isFinite(input.paddingY) && input.paddingY >= 0 ? input.paddingY : 0;
  const maxRows = input.maxRows ?? OPEN_ANSWER_MAX_ROWS;
  const computedMax = lineHeight * maxRows + paddingY;
  const cssMax =
    Number.isFinite(input.cssMaxHeight) && (input.cssMaxHeight as number) > 0
      ? (input.cssMaxHeight as number)
      : computedMax;
  const maxHeight = Math.min(computedMax, cssMax);
  const minHeight = Math.max(input.cssMinHeight ?? 0, lineHeight + paddingY);
  const contentHeight = Number.isFinite(input.scrollHeight) ? input.scrollHeight : minHeight;
  const height = Math.min(Math.max(contentHeight, minHeight), maxHeight);
  return {
    height,
    overflowY: contentHeight > maxHeight + 0.5 ? "auto" : "hidden",
  };
}

export function readOpenAnswerMetrics(el: HTMLTextAreaElement): {
  scrollHeight: number;
  lineHeight: number;
  paddingY: number;
  cssMinHeight: number;
  cssMaxHeight: number;
} {
  const styles = window.getComputedStyle(el);
  const fontSize = Number.parseFloat(styles.fontSize) || 16;
  const parsedLineHeight = Number.parseFloat(styles.lineHeight);
  return {
    scrollHeight: el.scrollHeight,
    lineHeight: Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.375,
    paddingY:
      (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0),
    cssMinHeight: Number.parseFloat(styles.minHeight) || 0,
    cssMaxHeight: Number.parseFloat(styles.maxHeight) || 0,
  };
}
