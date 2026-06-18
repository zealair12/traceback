import { useState } from 'react';
import type { ProviderInfo } from '@traceback/shared';
import { keyStore } from '../lib/keyStore';

interface KeyManagerProps {
  providers: ProviderInfo[];
  keyedProviders: Set<string>;
  onSave: (providerId: string, key: string) => void;
  onClear: (providerId: string) => void;
  onClose: () => void;
}

/**
 * "Bring your own key" panel. For each backend the user can paste their own API
 * key; it is saved only in this browser tab (sessionStorage) and sent in a
 * header with each message -- never to a database or a log. Keys are shown
 * masked (last 4 characters only) so the user can tell which one is saved.
 */
export function KeyManager({ providers, keyedProviders, onSave, onClear, onClose }: KeyManagerProps) {
  // Draft text the user is currently typing, per provider. Cleared after save so
  // the full key is not kept sitting in an input.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[460px] max-w-[92vw] max-h-[80vh] overflow-y-auto rounded-xl border border-gray-800 bg-gray-900 p-5 text-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold">Your API keys</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 text-sm"
          >
            Close
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mb-4 leading-relaxed">
          Keys are stored only in this browser tab and sent securely with each message.
          They are never saved on the server or in logs. Cleared when you close the tab.
        </p>

        <div className="space-y-3">
          {providers.map((p) => {
            const hasKey = keyedProviders.has(p.id);
            const stored = hasKey ? keyStore.get(p.id) : null;
            return (
              <div key={p.id} className="border border-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] font-medium text-gray-200">{p.id}</span>
                  {hasKey ? (
                    <span className="text-[10px] text-emerald-400">
                      saved {stored ? keyStore.hint(stored) : ''}
                    </span>
                  ) : p.configured ? (
                    <span className="text-[10px] text-gray-500">using server key</span>
                  ) : (
                    <span className="text-[10px] text-gray-600">no key</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={`Paste your ${p.id} API key`}
                    value={drafts[p.id] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    className="flex-1 bg-gray-950 border border-gray-800 rounded-md px-2 py-1 text-[11px] text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-600/50"
                  />
                  <button
                    type="button"
                    disabled={!(drafts[p.id] ?? '').trim()}
                    onClick={() => {
                      const v = (drafts[p.id] ?? '').trim();
                      if (!v) return;
                      onSave(p.id, v);
                      setDrafts((d) => ({ ...d, [p.id]: '' }));
                    }}
                    className="text-[11px] px-2 py-1 rounded-md bg-white text-black hover:bg-gray-200 disabled:opacity-30"
                  >
                    Save
                  </button>
                  {hasKey && (
                    <button
                      type="button"
                      onClick={() => onClear(p.id)}
                      className="text-[11px] px-2 py-1 rounded-md border border-gray-700 text-gray-300 hover:bg-gray-800"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
