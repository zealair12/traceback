import type { Session } from '../types';

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
}

/**
 * Sidebar: fixed-width left column showing:
 * - App branding
 * - "New Chat" primary action
 * - Scrollable list of sessions
 *
 * App-level layout (`App.tsx`) owns the actual session state and
 * passes it down; this component is purely presentational + emits
 * callbacks when the user interacts with it.
 */
export function Sidebar({
  sessions,
  activeSessionId,
  onNewSession,
  onSelectSession
}: SidebarProps) {
  return (
    <aside className="w-64 h-full bg-sidebar text-gray-100 flex flex-col">
      <div className="px-4 py-3">
        <h1 className="text-lg font-semibold">TraceBack</h1>
        <p className="text-xs text-gray-400 mt-1">Non-linear LLM conversations.</p>
        <button
          type="button"
          onClick={onNewSession}
          className="mt-4 w-full rounded-full bg-white text-black text-sm py-2 font-medium hover:bg-gray-200 transition-colors"
        >
          + New Chat
        </button>
      </div>

      <div className="h-px bg-gray-800" />

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <p className="text-xs text-gray-500 uppercase tracking-wide px-2 mb-2">
          Sessions
        </p>
        <div className="space-y-1">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelectSession(session.id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-300 hover:bg-gray-900 hover:text-white'
                }`}
              >
                {session.title}
              </button>
            );
          })}
          {sessions.length === 0 && (
            <p className="text-xs text-gray-500 px-2 pt-2">
              No sessions yet. Start a new chat.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

