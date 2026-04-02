import type { SessionResponse } from '../api/api';
import { useState } from 'react';

interface SidebarProps {
  sessions: SessionResponse[];
  activeSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
}

export function Sidebar({
  sessions,
  activeSessionId,
  onNewSession,
  onSelectSession,
  onRenameSession
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  return (
    <aside className="w-64 h-full bg-sidebar text-gray-100 flex flex-col flex-shrink-0">
      <div className="px-4 py-4">
        <h1 className="text-lg font-semibold tracking-tight">TraceBack</h1>
        <p className="text-[11px] text-gray-500 mt-0.5">Non-linear LLM conversations.</p>
        <button
          type="button"
          onClick={onNewSession}
          className="mt-4 w-full rounded-full bg-white text-black text-sm py-2 font-medium hover:bg-gray-200 transition-colors"
        >
          + New Chat
        </button>
      </div>

      <div className="h-px bg-gray-800" />

      <div className="flex-1 h-0 overflow-y-auto px-2 py-3">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest px-2 mb-2">
          Sessions
        </p>
        <div className="space-y-0.5">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const displayName = session.name?.trim() ? session.name : 'Untitled';
            const isEditing = editingId === session.id;
            return (
              <div
                key={session.id}
                className={`w-full px-2 py-1.5 rounded-lg text-sm transition-colors ${
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
                    className="text-[11px] text-gray-500 hover:text-gray-200 px-1"
                    title="Rename"
                  >
                    ✎
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
    </aside>
  );
}
