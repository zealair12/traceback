// Rehype plugin (runs after rehype-katex): wrap each rendered formula in a
// span.tb-math carrying its LaTeX source, so the reply can offer "copy LaTeX".
// Display formulas (span.katex-display) and inline ones (span.katex) are marked
// separately; the inner .katex of a display formula isn't wrapped twice.

import type { Element, Root } from 'hast';

const classes = (el: Element) => (Array.isArray(el.properties?.className) ? el.properties.className.map(String) : []);

// The TeX source KaTeX keeps in its MathML <annotation encoding="application/x-tex">.
function texSource(el: Element): string {
  let found = '';
  const walk = (node: Element) => {
    for (const child of node.children) {
      if (found || child.type !== 'element') continue;
      if (child.tagName === 'annotation' && child.properties?.encoding === 'application/x-tex') {
        found = child.children.map((c) => (c.type === 'text' ? c.value : '')).join('');
      } else walk(child);
    }
  };
  walk(el);
  return found.trim();
}

export function rehypeMathCopy() {
  return (tree: Root) => {
    const visit = (parent: Root | Element) => {
      parent.children.forEach((child, i) => {
        if (child.type !== 'element') return;
        const cls = classes(child);
        const kind = cls.includes('katex-display') ? 'display' : cls.includes('katex') ? 'inline' : null;
        if (!kind) return visit(child);
        parent.children[i] = {
          type: 'element',
          tagName: 'span',
          properties: { className: ['tb-math', `tb-math-${kind}`], dataTex: texSource(child) },
          children: [child]
        };
      });
    };
    visit(tree);
  };
}
