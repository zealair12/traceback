import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ProviderInfo } from '@traceback/shared';
import { Float } from './Popup';

interface ModelPickerProps {
  providers: ProviderInfo[];
  selectedProvider: string | null;
  selectedModel: string | null;
  keyedProviders?: Set<string>;
  onSelect: (providerId: string, model: string) => void;
}

const providerLabel: Record<string, string> = {
  groq: 'Groq',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  local: 'Local',
  auto: 'Auto'
};

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
  const triggerRef = useRef<HTMLButtonElement>(null);

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
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm text-gray-400 hover:text-gray-100 hover:bg-gray-800/60 transition-colors"
      >
        <span className="truncate max-w-[160px]">{triggerLabel}</span>
        <ChevronDown size={12} className="flex-shrink-0 opacity-60" />
      </button>

      <Float
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        width={256}
        align="left"
      >
        {/* Auto */}
        <button
          type="button"
          onClick={() => { onSelect('auto', 'auto'); setOpen(false); }}
          className="w-full px-4 py-2.5 text-left text-sm flex items-center justify-between hover:bg-gray-800/50 transition-colors"
        >
          <span className={isAuto ? 'text-white font-medium' : 'text-gray-300'}>Auto</span>
          {isAuto && <span className="h-1.5 w-1.5 rounded-full bg-gray-300 flex-shrink-0" />}
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
                    {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-gray-300 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          );
        })}
        <div className="pb-1" />
      </Float>
    </>
  );
}
