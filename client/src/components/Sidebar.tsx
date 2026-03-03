import type { SessionResponse } from '../api/api';

interface SidebarProps {
  sessions: SessionResponse[];
  activeSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
}

export function Sidebar({
  sessions,
  activeSessionId,
  onNewSession,
  onSelectSession
}: SidebarProps) {
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
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelectSession(session.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors truncate ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
                }`}
              >
                {session.name ?? 'Untitled'}
              </button>
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
