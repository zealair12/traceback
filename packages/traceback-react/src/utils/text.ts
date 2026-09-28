/** Strip markdown syntax for plain-text display (tree nodes, breadcrumbs). */
export function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')        // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')  // bold
    .replace(/\*(.+?)\*/g, '$1')      // italic
    .replace(/__(.+?)__/g, '$1')      // bold alt
    .replace(/_(.+?)_/g, '$1')        // italic alt
    .replace(/~~(.+?)~~/g, '$1')      // strikethrough
    .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, '')) // code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // images
    .replace(/^\s*[-*+]\s+/gm, '')    // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, '')    // ordered list markers
    .replace(/^\s*>\s+/gm, '')        // blockquotes
    .replace(/\n{2,}/g, ' ')          // collapse newlines
    .replace(/\n/g, ' ')
    .trim();
}

// Index of the `$` that would close inline math opened just before `from`, or -1.
// Uses Pandoc's rule: the next unescaped `$` on the same line, with a non-space
// character just before it and no digit just after it. That is what separates
// math like "$3 \times 10^8$" or "$2d/c$" from prices like "$917 ... $1,025".
function inlineMathClose(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\n') return -1;
    if (text[j] !== '$' || text[j - 1] === '\\') continue;
    return /\s/.test(text[j - 1]) || /\d/.test(text[j + 1] ?? '') ? -1 : j;
  }
  return -1;
}

// Escape dollar signs that are money, not math, so remark-math doesn't read
// "$917 ... $1,025" as inline math. A `$` right before a digit is money unless
// it has a valid closing `$` (see inlineMathClose). `$$` display math and
// already-escaped `\$` pass through untouched.
function escapeCurrencyDollars(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '$' || text[i - 1] === '\\') {
      out += text[i++];
    } else if (text[i + 1] === '$') {
      out += '$$';
      i += 2;
    } else if (!/\d/.test(text[i + 1] ?? '')) {
      out += text[i++];
    } else {
      const close = inlineMathClose(text, i + 1);
      if (close === -1) {
        out += '\\$';
        i += 1;
      } else {
        out += text.slice(i, close + 1); // real math: keep the whole span
        i = close + 1;
      }
    }
  }
  return out;
}

/**
 * Normalize LaTeX delimiters so remark-math can parse them.
 * LLMs often output \(...\) and \[...\] instead of $...$ and $$...$$.
 */
export function normalizeLatex(text: string): string {
  return (
    // Escape currency dollar signs FIRST, before the delimiter conversion below,
    // so only dollars the model actually wrote are judged.
    escapeCurrencyDollars(text)
      .replace(/\\\[/g, '$$')
      .replace(/\\\]/g, '$$')
      .replace(/\\\(/g, '$')
      .replace(/\\\)/g, '$')
  );
}
