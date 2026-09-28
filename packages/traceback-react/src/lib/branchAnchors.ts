// Branch anchors: the passage a branch was made from, so a reply can link its
// highlighted passages to the branches that grew out of them.
//
// A branch started from a passage records that passage in its first message:
//   Ask:  > "passage"\n\nthe question
//   Dig:  Explain this in more detail: "passage"
// Both formats are produced by this app (see digPrompt and the Composer), so
// parsing them back is deterministic.

import type { MessageResponse } from '@traceback/shared';

const DIG_PREFIX = 'Explain this in more detail: ';

// The auto-sent prompt for "Dig". Built here so the parser below always agrees.
export const digPrompt = (passage: string) => `${DIG_PREFIX}"${passage}"`;

// Split an Ask message into its quoted passage and the question under it.
// Anything else passes through with quote = null.
export function splitAskQuote(content: string): { quote: string | null; body: string } {
  const m = /^> "([\s\S]*?)"\n\n([\s\S]*)$/.exec(content);
  return m ? { quote: m[1], body: m[2] } : { quote: null, body: content };
}

// The passage a branch message was made from (Ask or Dig), or null.
export function branchPassage(content: string): { passage: string; label: string } | null {
  const ask = splitAskQuote(content);
  if (ask.quote) return { passage: ask.quote, label: ask.body.trim() };
  if (content.startsWith(DIG_PREFIX)) {
    const m = /^"([\s\S]*)"$/.exec(content.slice(DIG_PREFIX.length));
    if (m) return { passage: m[1], label: 'Explain in more detail' };
  }
  return null;
}

// One highlighted passage in a reply and every branch that grew from it.
export interface BranchAnchorGroup {
  text: string;
  branches: Array<{ childId: string; label: string }>;
}

// For every reply, the passages that have branches hanging off them, grouped by
// passage (the same passage can be branched more than once).
export function groupAnchorsByParent(messages: MessageResponse[]): Map<string, BranchAnchorGroup[]> {
  const byParent = new Map<string, BranchAnchorGroup[]>();
  for (const m of messages) {
    if (m.role !== 'user' || !m.parentId) continue;
    const found = branchPassage(m.content);
    if (!found || !found.passage.trim()) continue;
    const groups = byParent.get(m.parentId) ?? [];
    let group = groups.find((g) => g.text === found.passage);
    if (!group) {
      group = { text: found.passage, branches: [] };
      groups.push(group);
    }
    group.branches.push({ childId: m.id, label: found.label });
    byParent.set(m.parentId, groups);
  }
  return byParent;
}
