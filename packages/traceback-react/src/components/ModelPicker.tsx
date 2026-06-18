import { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ProviderInfo } from '@traceback/shared';

interface ModelPickerProps {
  providers: ProviderInfo[];
  selectedProvider: string | null;
  selectedModel: string | null;
  keyedProviders?: Set<string>;
  onSelect: (providerId: string, model: string) => void;
}

// Friendly short names shown in the trigger button.
const providerLabel: Record<string, string> = {
  groq: 'Groq',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  local: 'Local',
  auto: 'Auto'
};

// Shorten long model names for display (keep the meaningful part).
function shortModel(model: string): string {
  return model
    .replace(/^(llama|gemma|mixtral|mistral|deepseek)-?/i, '')
    .replace(/-?(instruct|chat|preview|latest|turbo|mini)$/i, '')
    .replace(/[_-]/g, ' ')
    .trim() || model;
}

export function ModelPicker({
  providers,
  selectedProvider,
  selectedModel,
  keyedProviders,
  onSelect
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const timer = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', close);
    };
  }, [open]);

  if (providers.length === 0) return null;

  const isAuto = !selectedProvider || selectedProvider === 'auto';
  const currentProviderLabel = isAuto
    ? 'Auto'
    : (providerLabel[selectedProvider] ?? selectedProvider);
  const currentModelLabel = isAuto || !selectedModel ? '' : shortModel(selectedModel);

  const triggerLabel = currentModelLabel
    ? `${currentProviderLabel} · ${currentModelLabel}`
    : currentProviderLabel;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm text-gray-400 hover:text-gray-100 hover:bg-gray-800/60 transition-colors"
      >
        <span className="truncate max-w-[160px]">{triggerLabel}</span>
        <ChevronDown size={12} className="flex-shrink-0 opacity-60" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-60 rounded-xl border border-gray-700/60 bg-gray-950/95 backdrop-blur-xl shadow-2xl overflow-hidden z-50">
          {/* Auto */}
          <button
            type="button"
            onClick={() => { onSelect('auto', 'auto'); setOpen(false); }}
            className="w-full px-4 py-2.5 text-left text-sm flex items-center justify-between hover:bg-gray-800/50 transition-colors"
          >
            <span className={isAuto ? 'text-white font-medium' : 'text-gray-300'}>Auto</span>
            {isAuto && <Check size={14} className="text-emerald-400 flex-shrink-0" />}
          </button>

          <div className="h-px bg-gray-800/60" />

          {providers.map((p) => {
            const usable = p.configured || keyedProviders?.has(p.id);
            const label = providerLabel[p.id] ?? p.id;
            const models = p.suggestedModels ?? [];
            if (models.length === 0) return null;
            return (
              <div key={p.id}>
                <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                  {label}
                  {!usable && <span className="normal-case font-normal text-gray-600">no key</span>}
                </div>
                {models.map((model) => {
                  const isSelected = selectedProvider === p.id && selectedModel === model;
                  return (
                    <button
                      key={model}
                      type="button"
                      disabled={!usable}
                      onClick={() => { onSelect(p.id, model); setOpen(false); }}
                      className="w-full px-4 py-1.5 text-left text-sm flex items-center justify-between hover:bg-gray-800/50 transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
                    >
                      <span className={isSelected ? 'text-white font-medium' : 'text-gray-300'}>
                        {model}
                      </span>
                      {isSelected && <Check size={13} className="text-emerald-400 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="pb-1" />
        </div>
      )}
    </div>
  );
}
