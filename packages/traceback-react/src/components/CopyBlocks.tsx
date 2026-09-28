// Copy buttons inside rendered replies: one on each code block (copies the
// code) and one on each formula (copies its LaTeX source). On desktop they
// appear on hover; on phones the code button is always shown and a formula's
// button appears when you tap the formula.

import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

// Older browsers and some in-app webviews refuse the async clipboard API.
function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    /* not supported */
  }
  ta.remove();
  return ok;
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    if (!text) return;
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    const write = navigator.clipboard?.writeText(text);
    if (write) write.then(done, () => legacyCopy(text) && done());
    else if (legacyCopy(text)) done();
  };
  return { copied, copy };
}

type PreProps = ComponentProps<'pre'> & { node?: unknown };

export function CodeBlock({ node: _node, children, ...props }: PreProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const { copied, copy } = useCopy();
  return (
    <div className="tb-code group/code relative">
      <pre ref={preRef} {...props}>
        {children}
      </pre>
      <button
        type="button"
        onClick={() => copy((preRef.current?.querySelector('code') ?? preRef.current)?.textContent?.replace(/\n$/, '') ?? '')}
        className="absolute top-1.5 right-1.5 h-7 w-7 rounded-md flex items-center justify-center bg-gray-800/90 border border-gray-700 text-gray-400 hover:text-gray-100 transition-opacity opacity-100 md:opacity-0 md:group-hover/code:opacity-100 focus:opacity-100"
        title={copied ? 'Copied' : 'Copy code'}
        aria-label="Copy code"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

type SpanProps = ComponentProps<'span'> & { node?: unknown; 'data-tex'?: string };

// Routes react-markdown's spans: formulas marked by rehypeMathCopy get a copy
// button; every other span renders as usual.
export function MarkdownSpan({ node: _node, children, ...props }: SpanProps) {
  const tex = props['data-tex'];
  if (tex === undefined || !String(props.className ?? '').includes('tb-math')) {
    return <span {...props}>{children}</span>;
  }
  const display = String(props.className).includes('tb-math-display');
  return (
    <MathCopy tex={tex} display={display}>
      {children}
    </MathCopy>
  );
}

function MathCopy({ tex, display, children }: { tex: string; display: boolean; children: ReactNode }) {
  const { copied, copy } = useCopy();
  const button = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copy(tex);
      }}
      className={`tb-math-copy absolute h-6 w-6 rounded-md flex items-center justify-center bg-gray-800/90 border border-gray-700 text-gray-400 hover:text-gray-100 transition-opacity opacity-0 group-hover/math:opacity-100 group-focus-within/math:opacity-100 ${
        display ? 'top-0 right-0 max-md:opacity-100' : 'bottom-full left-1/2 -translate-x-1/2 mb-0.5 z-10'
      }`}
      title={copied ? 'Copied' : 'Copy LaTeX'}
      aria-label="Copy LaTeX"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
  return (
    // tabIndex lets a tap focus an inline formula on phones, revealing its button.
    <span className={`group/math relative ${display ? 'block' : 'outline-none'}`} tabIndex={display ? undefined : 0}>
      {children}
      {button}
    </span>
  );
}
