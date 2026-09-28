// Rehype plugin: wrap the passages a user branched from in a clickable span.
//
// Runs on the rendered-markdown tree (after KaTeX), so it matches the text the
// user actually highlighted, even when it crosses formatting, e.g. a bold label
// followed by plain text ("**Distance:** The physical distance"). Matching is
// done per block (paragraph, list item, heading, table cell): the block's text
// nodes are joined, the passage is found (whitespace- and case-tolerant), and
// each text node the match touches is split around it. Code, links and math are
// never touched. Each passage is marked once, at its first occurrence.

import type { Element, ElementContent, Root, RootContent, Text } from 'hast';
import type { BranchAnchorGroup } from './branchAnchors';

const BLOCKS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'dt', 'dd']);
const OPAQUE = new Set(['pre', 'code', 'a', 'script', 'style', 'svg']);
const CONTAINERS = new Set(['ul', 'ol', 'table', 'thead', 'tbody', 'tr', 'blockquote']);

type Parent = Root | Element;
interface Run {
  node: Text;
  parent: Parent;
}

// Key-term links (term:...) are part of the prose, so passages may run through
// them; ordinary links stay untouched.
const isTermLink = (el: Element) => el.tagName === 'a' && String(el.properties?.href ?? '').startsWith('term:');
const isOpaque = (el: Element) => (OPAQUE.has(el.tagName) && !isTermLink(el)) || isKatex(el);

const isKatex = (el: Element) => {
  const cls = el.properties?.className;
  return Array.isArray(cls) && cls.some((c) => String(c).startsWith('katex'));
};

// Visit block elements in document order (blocks can nest: li > p).
function eachBlock(node: Parent, fn: (block: Element) => void) {
  for (const child of node.children as RootContent[]) {
    if (child.type !== 'element') continue;
    if (isOpaque(child)) continue;
    if (BLOCKS.has(child.tagName)) fn(child);
    eachBlock(child, fn);
  }
}

// The block's own inline text, in order, stopping at nested blocks/containers.
function collectRuns(block: Element): Run[] {
  const runs: Run[] = [];
  const walk = (parent: Element) => {
    for (const child of parent.children) {
      if (child.type === 'text') runs.push({ node: child, parent });
      else if (child.type === 'element') {
        if (BLOCKS.has(child.tagName) || CONTAINERS.has(child.tagName)) continue;
        if (isOpaque(child)) continue;
        walk(child);
      }
    }
  };
  walk(block);
  return runs;
}

// Collapse whitespace runs to one space, keeping a map back to the raw indices.
function normalize(raw: string) {
  let norm = '';
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      prevSpace = true;
      norm += ' ';
    } else {
      prevSpace = false;
      norm += ch.toLowerCase();
    }
    map.push(i);
  }
  map.push(raw.length);
  return { norm, map };
}

function anchorSpan(value: string, group: BranchAnchorGroup): Element {
  const n = group.branches.length;
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: ['tb-branch-anchor'],
      dataBranchChildren: group.branches.map((b) => b.childId).join(' '),
      title: n > 1 ? `${n} branches start here` : 'Open the branch you started here'
    },
    children: [{ type: 'text', value }]
  };
}

export function rehypeBranchAnchors(groups: BranchAnchorGroup[] = []) {
  return (tree: Root) => {
    if (groups.length === 0) return;
    // Longest passages first, so a short passage can't steal part of a longer one.
    const pending = [...groups].sort((a, b) => b.text.length - a.text.length);
    const done = new Set<BranchAnchorGroup>();

    eachBlock(tree, (block) => {
      const runs = collectRuns(block);
      if (runs.length === 0) return;
      const starts: number[] = [];
      let full = '';
      for (const r of runs) {
        starts.push(full.length);
        full += r.node.value;
      }
      const { norm, map } = normalize(full);

      const ranges: Array<{ start: number; end: number; group: BranchAnchorGroup }> = [];
      for (const g of pending) {
        if (done.has(g)) continue;
        const needle = normalize(g.text.trim()).norm;
        if (!needle) continue;
        const at = norm.indexOf(needle);
        if (at < 0) continue;
        const start = map[at];
        const end = map[at + needle.length - 1] + 1;
        if (ranges.some((r) => start < r.end && end > r.start)) continue;
        ranges.push({ start, end, group: g });
        done.add(g);
      }
      if (ranges.length === 0) return;

      runs.forEach((r, i) => {
        const s0 = starts[i];
        const s1 = s0 + r.node.value.length;
        const hits = ranges.filter((x) => x.start < s1 && x.end > s0).sort((a, b) => a.start - b.start);
        if (hits.length === 0) return;
        const out: ElementContent[] = [];
        let pos = s0;
        for (const h of hits) {
          const a = Math.max(h.start, s0);
          const b = Math.min(h.end, s1);
          if (a > pos) out.push({ type: 'text', value: full.slice(pos, a) });
          out.push(anchorSpan(full.slice(a, b), h.group));
          pos = b;
        }
        if (pos < s1) out.push({ type: 'text', value: full.slice(pos, s1) });
        const siblings = r.parent.children as ElementContent[];
        siblings.splice(siblings.indexOf(r.node), 1, ...out);
      });
    });
  };
}
