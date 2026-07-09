// A collapsed "trace" of an agent's steps (its tool calls and results), shown in
// place of dumping each step as a raw message. Muted and expandable, so the
// final answer stays clean — the way agent UIs (ChatGPT, Perplexity) show it.

import { useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import type { ChatMessage } from '../types';
import { stripMarkdown } from '../utils/text';

// Turn a persisted tool-call node ("**web_search** {json}") into a human label.
function humanizeToolCall(content: string): string {
  const m = /^\*\*(\w+)\*\*\s*([\s\S]*)$/.exec(content);
  const tool = m?.[1] ?? 'tool';
  const argsRaw = (m?.[2] ?? '').trim();
  if (tool === 'web_search') {
    try {
      const q = JSON.parse(argsRaw).query;
      if (q) return `Searched the web: ${q}`;
    } catch {
      /* fall through */
    }
    return 'Searched the web';
  }
  if (tool === 'current_datetime') return 'Checked the current date and time';
  return tool.replace(/_/g, ' ');
}

export function AgentTrace({ steps }: { steps: ChatMessage[] }) {
  const [open, setOpen] = useState(false);
  const stepCount = steps.filter((s) => s.branchLabel === 'tool_call').length;

  return (
    <div className="flex items-start gap-3">
      {/* Spacer to line up with message bubbles (which have a 7x7 avatar). */}
      <div className="w-7 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
        >
          <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          <span>
            {stepCount > 0 ? `Worked through ${stepCount} step${stepCount > 1 ? 's' : ''}` : 'Agent steps'}
          </span>
        </button>

        {open && (
          <div className="mt-1.5 ml-[5px] pl-3 border-l border-gray-800 space-y-2">
            {steps.map((s) =>
              s.branchLabel === 'tool_call' ? (
                <div key={s.id} className="flex items-center gap-1.5 text-[12px] text-gray-400">
                  <Search size={12} className="flex-shrink-0 opacity-70" />
                  <span className="truncate">{humanizeToolCall(s.content)}</span>
                </div>
              ) : (
                <div key={s.id} className="text-[11px] text-gray-500 leading-relaxed line-clamp-4">
                  {stripMarkdown(s.content).slice(0, 400)}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
