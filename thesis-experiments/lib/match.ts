// Term matching shared by the validator and (later) the leak detector.
// Case-insensitive, and a term only matches as a whole token: the characters
// on either side must not be letters, digits or underscore. So "LFU" does not
// match inside "SLRU", and "7413" does not match inside "17413".

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function termRegex(term: string, flags = 'i'): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_])${escape(term)}(?![A-Za-z0-9_])`, flags);
}

export function containsTerm(text: string, term: string): boolean {
  return termRegex(term).test(text);
}

export function countTerm(text: string, term: string): number {
  return (text.match(termRegex(term, 'gi')) ?? []).length;
}
