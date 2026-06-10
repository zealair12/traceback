import { useRef, useState } from 'react';
import {
  parseImportFile,
  conversationStats,
  type ImportedConversation
} from '@traceback/shared';

interface ImportPanelProps {
  // Writes the chosen conversations to the server and returns how many landed.
  onImport: (conversations: ImportedConversation[]) => Promise<number>;
  onClose: () => void;
}

type Phase =
  | { step: 'pick' }
  | { step: 'preview'; importerId: string; conversations: ImportedConversation[]; selected: boolean[] }
  | { step: 'importing' }
  | { step: 'done'; count: number }
  | { step: 'error'; message: string };

/**
 * "Import chats" panel. The user drops in a history file they exported from
 * another product (ChatGPT's conversations.json, or any plain JSON list of
 * messages). The file is parsed right here in the browser, previewed, and the
 * selected conversations are written to the Traceback server as trees --
 * ChatGPT's hidden branches included. The file itself never leaves the
 * browser; only the parsed conversations are sent to your own server.
 */
export function ImportPanel({ onImport, onClose }: ImportPanelProps) {
  const [phase, setPhase] = useState<Phase>({ step: 'pick' });
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const { importerId, conversations } = parseImportFile(data);
      if (conversations.length === 0) {
        setPhase({ step: 'error', message: 'No importable conversations found in that file.' });
        return;
      }
      setPhase({ step: 'preview', importerId, conversations, selected: conversations.map(() => true) });
    } catch (err: any) {
      setPhase({
        step: 'error',
        message:
          err?.message?.includes('JSON')
            ? 'That file is not valid JSON. For ChatGPT, unzip the export and drop conversations.json.'
            : err?.message ?? 'Could not read that file.'
      });
    }
  };

  const runImport = async () => {
    if (phase.step !== 'preview') return;
    const chosen = phase.conversations.filter((_, i) => phase.selected[i]);
    if (chosen.length === 0) return;
    setPhase({ step: 'importing' });
    try {
      const count = await onImport(chosen);
      setPhase({ step: 'done', count });
    } catch (err: any) {
      setPhase({ step: 'error', message: err?.response?.data?.error ?? err?.message ?? 'Import failed.' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[480px] max-w-[92vw] max-h-[80vh] overflow-y-auto rounded-xl border border-gray-800 bg-gray-900 p-5 text-gray-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold">Import chats</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-200 text-sm">
            Close
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mb-4 leading-relaxed">
          Bring your history from ChatGPT (Settings, Data controls, Export data, then drop the
          conversations.json from the zip) or any JSON list of messages. Conversations import as
          trees; branches from edited or regenerated messages are preserved.
        </p>

        {phase.step === 'pick' && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver ? 'border-emerald-500 bg-emerald-500/5' : 'border-gray-700 hover:border-gray-500'
            }`}
          >
            <p className="text-[13px] text-gray-300">Drop your export file here</p>
            <p className="text-[11px] text-gray-600 mt-1">or click to choose a .json file</p>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>
        )}

        {phase.step === 'preview' && (
          <>
            <p className="text-[11px] text-gray-400 mb-2">
              Found {phase.conversations.length} conversation
              {phase.conversations.length === 1 ? '' : 's'} ({phase.importerId} format). Pick which
              to import:
            </p>
            <div className="space-y-1 mb-4 max-h-[40vh] overflow-y-auto">
              {phase.conversations.map((c, i) => {
                const stats = conversationStats(c);
                return (
                  <label
                    key={i}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-800/60 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={phase.selected[i]}
                      onChange={() =>
                        setPhase({
                          ...phase,
                          selected: phase.selected.map((s, j) => (j === i ? !s : s))
                        })
                      }
                    />
                    <span className="flex-1 min-w-0 truncate text-[12px] text-gray-200">
                      {c.name ?? 'Untitled'}
                    </span>
                    <span className="text-[10px] text-gray-500 tabular-nums flex-shrink-0">
                      {stats.messageCount} msgs
                      {stats.branchCount > 0 ? ` · ${stats.branchCount} branch${stats.branchCount === 1 ? '' : 'es'}` : ''}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPhase({ step: 'pick' })}
                className="text-[11px] px-3 py-1.5 rounded-md border border-gray-700 text-gray-300 hover:bg-gray-800"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!phase.selected.some(Boolean)}
                onClick={runImport}
                className="text-[11px] px-3 py-1.5 rounded-md bg-white text-black hover:bg-gray-200 disabled:opacity-30"
              >
                Import {phase.selected.filter(Boolean).length} conversation
                {phase.selected.filter(Boolean).length === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}

        {phase.step === 'importing' && (
          <p className="text-[12px] text-gray-400 animate-pulse py-6 text-center">Importing…</p>
        )}

        {phase.step === 'done' && (
          <div className="py-4 text-center">
            <p className="text-[13px] text-emerald-400">
              Imported {phase.count} conversation{phase.count === 1 ? '' : 's'}.
            </p>
            <p className="text-[11px] text-gray-500 mt-1">
              They are in your sessions list now; open one to see its tree.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 text-[11px] px-3 py-1.5 rounded-md bg-white text-black hover:bg-gray-200"
            >
              Done
            </button>
          </div>
        )}

        {phase.step === 'error' && (
          <div className="py-2">
            <p className="text-[12px] text-red-400 bg-red-400/10 rounded-md px-3 py-2">{phase.message}</p>
            <button
              type="button"
              onClick={() => setPhase({ step: 'pick' })}
              className="mt-3 text-[11px] px-3 py-1.5 rounded-md border border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              Try another file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
