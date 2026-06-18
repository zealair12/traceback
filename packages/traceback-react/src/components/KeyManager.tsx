import { useState } from 'react';
import type { ProviderInfo } from '@traceback/shared';
import { keyStore } from '../lib/keyStore';
import { X } from 'lucide-react';
import { Modal } from './Popup';

interface KeyManagerProps {
  providers: ProviderInfo[];
  keyedProviders: Set<string>;
  onSave: (providerId: string, key: string) => void;
  onClear: (providerId: string) => void;
  onClose: () => void;
}

function detectProviderId(key: string, providers: ProviderInfo[]): string | null {
  const k = key.trim();
  if (k.startsWith('sk-ant-')) return providers.find((p) => p.id.includes('anthropic'))?.id ?? null;
  if (k.startsWith('sk-proj-') || (k.startsWith('sk-') && !k.startsWith('sk-ant-')))
    return providers.find((p) => p.id.includes('openai'))?.id ?? null;
  if (k.startsWith('AIza')) return providers.find((p) => p.id.includes('google') || p.id.includes('gemini'))?.id ?? null;
  if (k.startsWith('gsk_')) return providers.find((p) => p.id.includes('groq'))?.id ?? null;
  if (k.startsWith('mistral')) return providers.find((p) => p.id.includes('mistral'))?.id ?? null;
  return null;
}

export function KeyManager({ providers, keyedProviders, onSave, onClear, onClose }: KeyManagerProps) {
  const [draft, setDraft] = useState('');

  const detectedId = draft.trim() ? detectProviderId(draft, providers) : null;

  const handleSave = () => {
    const v = draft.trim();
    if (!v || !detectedId) return;
    onSave(detectedId, v);
    setDraft('');
  };

  const savedKeys = providers.filter((p) => keyedProviders.has(p.id));

  return (
    <Modal onClose={onClose} width={420}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">API keys</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="password"
            autoComplete="off"
            placeholder="Paste an API key…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            className="flex-1 bg-gray-950 border border-gray-800 rounded-md px-3 py-1.5 text-[12px] text-gray-100 focus:outline-none focus:ring-1 focus:ring-gray-600/60"
          />
          <button
            type="button"
            disabled={!draft.trim() || !detectedId}
            onClick={handleSave}
            className="text-[11px] px-3 py-1.5 rounded-md bg-white text-black hover:bg-gray-200 disabled:opacity-30"
          >
            Save
          </button>
        </div>

        {draft.trim() && (
          <p className="text-[10px] mt-1.5 px-0.5">
            {detectedId
              ? <span className="text-gray-300">Detected: {detectedId}</span>
              : <span className="text-gray-500">Unrecognized key format</span>}
          </p>
        )}

        {savedKeys.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {savedKeys.map((p) => {
              const stored = keyStore.get(p.id);
              return (
                <div key={p.id} className="flex items-center justify-between border border-gray-800 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-[12px] text-gray-200">{p.id}</span>
                    {stored && (
                      <span className="text-[10px] text-gray-500 ml-2">{keyStore.hint(stored)}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onClear(p.id)}
                    className="text-gray-500 hover:text-red-400 transition-colors"
                    title="Remove key"
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
