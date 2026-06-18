// Naming helpers for sessions.

import { stripMarkdown } from '../utils/text';

export function isUntitledSessionName(name: string | null): boolean {
  return !name || !name.trim() || name.trim().toLowerCase() === 'new conversation';
}

// A short human title distilled from the first question.
export function summarizeTopic(text: string): string {
  const clean = stripMarkdown(text).replace(/\s+/g, ' ').trim();
  if (!clean) return 'Untitled';
  const simplified = clean.replace(/^(what is|how to|can you|please|explain|help me)\s+/i, '');
  const words = simplified.split(' ').slice(0, 6).join(' ');
  const titled = words.charAt(0).toUpperCase() + words.slice(1);
  return titled.replace(/[?.!,;:]+$/, '') || 'Untitled';
}
