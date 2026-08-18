// greedy word wrap by character budget. svg text has no native wrapping,
// and glyph measurement is unavailable in the test environment (jsdom has
// no layout), so lines break on an estimated character count instead of
// measured pixels — callers derive maxChars from the font size

/** split text into lines of at most maxChars, breaking between words; a
    single word longer than the budget keeps its own line unbroken */
export function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}
