import type { SessionResponse, AuthMeResponse } from '@traceback/shared';
import { useState } from 'react';
import { Settings, FolderDown, KeyRound, Trash2, LogOut } from 'lucide-react';
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
  authState: AuthMeResponse | null;
  onSignIn: () => void;
  onSignOut: () => void;
}

const themeStyle: Record<Theme, string> = {
  dark:  'bg-gray-900 text-gray-100 ring-1 ring-gray-600',
  blue:  'bg-blue-950 text-blue-300 ring-1 ring-blue-700',
  light: 'bg-gray-100 text-gray-800 ring-1 ring-gray-300',
};
const themeIdle = 'text-gray-500 hover:text-gray-300';

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
  onSetTheme,
  authState,
  onSignIn,
  onSignOut
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  return (
    // `relative` so the settings menu can be absolutely positioned inside
    <aside className="relative w-full h-full bg-sidebar text-gray-100 flex flex-col flex-shrink-0">
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
          className="mt-4 w-full rounded-full bg-white text-black text-sm py-2.5 font-medium hover:bg-gray-200 transition-colors"
        >
          + New Chat
        </button>
      </div>

      {/* Session list — larger tap targets, rename/delete always visible on mobile */}
      <div className="flex-1 h-0 overflow-y-auto px-2 py-3">
        <div className="space-y-0.5">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const displayName = session.name?.trim() ? session.name : 'Untitled';
            const isEditing = editingId === session.id;
            return (
              <div
                key={session.id}
                className={`group w-full px-2 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => { onRenameSession(session.id, editValue); setEditingId(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { onRenameSession(session.id, editValue); setEditingId(null); }
                        else if (e.key === 'Escape') { setEditingId(null); }
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
                  {/* Always visible on mobile; hidden until hover on desktop */}
                  {confirmDeleteId === session.id ? (
                    <>
                      <span className="text-[10px] text-gray-500 mr-0.5">Sure?</span>
                      <button
                        type="button"
                        onClick={() => { onDeleteSession(session.id); setConfirmDeleteId(null); }}
                        className="text-[10px] text-red-400 hover:text-red-300 px-1 py-1"
                        title="Confirm delete"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[10px] text-gray-500 hover:text-gray-300 px-1 py-1"
                        title="Cancel"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => { setEditingId(session.id); setEditValue(displayName === 'Untitled' ? '' : displayName); }}
                        className="text-[11px] text-gray-500 hover:text-gray-200 px-1.5 py-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                        title="Rename"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(session.id)}
                        className="text-gray-500 hover:text-red-400 px-1.5 py-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {sessions.length === 0 && (
            <p className="text-xs text-gray-600 px-2 pt-4 text-center">No sessions yet.</p>
          )}
        </div>
      </div>

      {/* Auth bar — sign in prompt for guests, avatar + name for users */}
      {authState?.isGuest ? (
        <div className="px-3 py-2.5 border-t border-gray-800/50">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-gray-500">
              {Math.max(0, authState.dailyLimit - authState.messagesUsedToday)} free messages left today
            </span>
          </div>
          <div className="w-full bg-gray-800/50 rounded-full h-1 mb-2.5">
            <div
              className="bg-blue-500 h-1 rounded-full transition-all"
              style={{
                width: `${Math.max(0, Math.min(100, ((authState.dailyLimit - authState.messagesUsedToday) / authState.dailyLimit) * 100))}%`
              }}
            />
          </div>
          <button
            type="button"
            onClick={onSignIn}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-white text-[#3c4043] text-[12px] font-medium hover:bg-gray-50 transition-colors border border-gray-200"
          >
            {/* Google "G" logo — required by Google's OAuth branding guidelines */}
            <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>
        </div>
      ) : authState && !authState.isGuest ? (
        <div className="px-3 py-2.5 border-t border-gray-800/50 flex items-center gap-2">
          {authState.avatar ? (
            <img src={authState.avatar} alt="" className="h-7 w-7 rounded-full flex-shrink-0" />
          ) : (
            <div className="h-7 w-7 rounded-full bg-blue-600 flex items-center justify-center text-[11px] text-white flex-shrink-0">
              {(authState.name ?? authState.email)?.[0]?.toUpperCase()}
            </div>
          )}
          <span className="flex-1 min-w-0 text-[12px] text-gray-300 truncate">
            {authState.name ?? authState.email}
          </span>
          {confirmSignOut ? (
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-[10px] text-gray-500">Sure?</span>
              <button
                type="button"
                onClick={() => { onSignOut(); setConfirmSignOut(false); }}
                className="text-[10px] text-red-400 hover:text-red-300 px-1"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmSignOut(false)}
                className="text-[10px] text-gray-500 hover:text-gray-300 px-1"
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmSignOut(true)}
              title="Sign out"
              className="text-gray-500 hover:text-gray-200 transition-colors flex-shrink-0"
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
      ) : null}

      {/* Bottom bar: theme + settings gear */}
      <div className="px-3 py-3 border-t border-gray-800/50 flex items-center gap-2">
        {/* Coloured theme buttons */}
        <div className="flex gap-1 flex-1">
          {(['dark', 'blue', 'light'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onSetTheme(t)}
              className={`flex-1 py-1.5 rounded text-[11px] capitalize transition-colors ${
                theme === t ? themeStyle[t] : themeIdle
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Settings gear — opens a simple absolute menu (no portal) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
              menuOpen ? 'text-gray-100 bg-gray-800' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
            }`}
            title="Settings"
          >
            <Settings size={16} />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute bottom-full right-0 mb-2 w-44 rounded-xl border border-gray-700/50 bg-gray-900 shadow-xl z-50 py-1.5">
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onOpenImport(); }}
                  className="w-full text-left px-3 py-2.5 text-[13px] text-gray-300 hover:bg-gray-800/80 hover:text-white flex items-center gap-2.5"
                >
                  <FolderDown size={15} className="text-gray-500 flex-shrink-0" />
                  Import chats
                </button>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onOpenKeys(); }}
                  className="w-full text-left px-3 py-2.5 text-[13px] text-gray-300 hover:bg-gray-800/80 hover:text-white flex items-center gap-2.5"
                >
                  <KeyRound size={15} className="text-gray-500 flex-shrink-0" />
                  API keys
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
