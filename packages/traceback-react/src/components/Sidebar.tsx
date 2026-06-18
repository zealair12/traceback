import type { SessionResponse } from '@traceback/shared';
import { useState } from 'react';
import { FolderDown, KeyRound, Trash2 } from 'lucide-react';
import { BrandIcon } from './BrandIcon';

type Theme = 'dark' | 'blue' | 'light';

interface SidebarProps {
  sessions: SessionResponse[];
  activeSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenKeys: () => void;
  onOpenImport: () => void;
  theme: Theme;
  onSetTheme: (t: Theme) => void;
}

export function Sidebar({
  sessions,
  activeSessionId,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onOpenKeys,
  onOpenImport,
  theme,
  onSetTheme
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  return (
    <aside className="w-full h-full bg-sidebar text-gray-100 flex flex-col flex-shrink-0">
      <div className="px-4 py-4">
        <h1 className="flex items-center gap-2">
          <BrandIcon size={22} className="text-blue-400" />
          <span style={{ fontFamily: "'Raleway', sans-serif", fontWeight: 300, fontSize: '1.25rem', letterSpacing: '0.18em' }}>
            traceback
          </span>
        </h1>
        <button
          type="button"
          onClick={onNewSession}
          className="mt-4 w-full rounded-full bg-white text-black text-sm py-2 font-medium hover:bg-gray-200 transition-colors"
        >
          + New Chat
        </button>
      </div>

      <div className="flex-1 h-0 overflow-y-auto px-2 py-3">
        <div className="space-y-0.5">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const displayName = session.name?.trim() ? session.name : 'Untitled';
            const isEditing = editingId === session.id;
            return (
              <div
                key={session.id}
                className={`group w-full px-2 py-1.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => {
                        onRenameSession(session.id, editValue);
                        setEditingId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onRenameSession(session.id, editValue);
                          setEditingId(null);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                      className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectSession(session.id)}
                      className="flex-1 min-w-0 truncate text-left"
                    >
                      {displayName}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(session.id);
                      setEditValue(displayName === 'Untitled' ? '' : displayName);
                    }}
                    className="text-[11px] text-gray-500 hover:text-gray-200 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Rename"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteSession(session.id)}
                    className="text-gray-500 hover:text-red-400 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
          {sessions.length === 0 && (
            <p className="text-xs text-gray-600 px-2 pt-4 text-center">
              No sessions yet.
            </p>
          )}
        </div>
      </div>

      <div className="px-3 py-3 border-t border-gray-800/50 space-y-2">
        {/* Theme switcher */}
        <div className="flex gap-1">
          {(['dark', 'blue', 'light'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onSetTheme(t)}
              className={`flex-1 py-1 rounded text-[11px] capitalize transition-colors ${
                theme === t ? 'bg-gray-700/80 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {/* Import and API keys */}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onOpenImport}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12px] text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
          >
            <FolderDown size={13} />
            <span>Import</span>
          </button>
          <button
            type="button"
            onClick={onOpenKeys}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12px] text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
          >
            <KeyRound size={13} />
            <span>API keys</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
