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

// Apply `fn` to everything except code: inline `code` spans and ``` fenced
// blocks (a backtick run closed by a run of the same length). Code is shown
// verbatim, so math and currency handling must never touch it.
function mapOutsideCode(text: string, fn: (prose: string) => string): string {
  let out = '';
  let prose = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`' || text[i - 1] === '\\') {
      prose += text[i++];
      continue;
    }
    let n = 0;
    while (text[i + n] === '`') n++;
    const run = '`'.repeat(n);
    let close = -1;
    for (let j = text.indexOf(run, i + n); j !== -1; j = text.indexOf(run, j)) {
      let end = j;
      while (text[end] === '`') end++;
      if (end - j === n) {
        close = j;
        break;
      }
      j = end;
    }
    if (close === -1) {
      // Unclosed (or still streaming): just literal backticks for now.
      prose += run;
      i += n;
      continue;
    }
    out += fn(prose) + text.slice(i, close + n);
    prose = '';
    i = close + n;
  }
  return out + fn(prose);
}

// LLMs often write \(...\) and \[...\] instead of $...$ and $$...$$. remark-math
// renders $$ as a centered display block only when the $$ lines stand alone,
// so \[...\] set on its own line(s) becomes such a block (keeping the line's
// indentation, so it stays inside a list item); mid-sentence it can only be
// inline. (Replacements use functions: in a replacement string "$$" means "$".)
function convertMathDelimiters(prose: string): string {
  return prose
    .replace(/^([ \t]*)\\\[((?:(?!\\\[)[\s\S])*?)\\\][ \t]*$/gm, (_m, indent: string, body: string) =>
      [`${indent}$$`, ...body.trim().split('\n').map((line) => indent + line.trim()), `${indent}$$`].join('\n')
    )
    .replace(/\\\[((?:(?!\\\[)[\s\S])*?)\\\]/g, (_m, body: string) => `$${body.trim()}$`)
    .replace(/\\\(/g, () => '$')
    .replace(/\\\)/g, () => '$');
}

/**
 * Prepare a reply's markdown for remark-math: escape dollars that are money,
 * then normalize \(...\) / \[...\] delimiters. Code is left untouched.
 */
export function normalizeLatex(text: string): string {
  // Currency first, so only dollars the model actually wrote are judged.
  return mapOutsideCode(text, (prose) => convertMathDelimiters(escapeCurrencyDollars(prose)));
}
