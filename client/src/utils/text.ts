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

/**
 * Normalize LaTeX delimiters so remark-math can parse them.
 * LLMs often output \(...\) and \[...\] instead of $...$ and $$...$$.
 */
export function normalizeLatex(text: string): string {
  return text
    .replace(/\\\[/g, '$$')
    .replace(/\\\]/g, '$$')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$');
}
