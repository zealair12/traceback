import './index.css'

/**
 * High-level layout shell for TraceBack.
 *
 * This component is responsible only for the *visual zoning* of the app:
 * - Left: sessions sidebar
 * - Center: main chat panel
 * - Right: conversation tree (React Flow placeholder)
 *
 * The actual data/logic for sessions, active node state, and tree syncing
 * will be added in later iterations; for now this file documents how
 * the three panels relate to each other.
 */
function App() {
  return (
    <div className="h-screen w-screen bg-background text-white flex">
      {/* Left sidebar: sessions list + new chat */}
      <aside className="w-64 bg-sidebar border-r border-borderStrong flex flex-col">
        <div className="p-4 border-b border-borderStrong">
          <h1 className="text-lg font-semibold tracking-tight">TraceBack</h1>
          <p className="mt-1 text-xs text-gray-400">
            Non-linear, tree-based conversations.
          </p>
          <button className="mt-4 w-full rounded-md bg-accent hover:bg-accentMuted text-sm py-2 font-medium transition-colors">
            + New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 text-sm text-gray-300">
          {/* Placeholder sessions list – will be populated from /sessions */}
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
            Sessions
          </p>
          <div className="space-y-1">
            <div className="rounded px-2 py-1 bg-panel/60 border border-borderStrong text-xs">
              Example session
            </div>
          </div>
        </div>
      </aside>

      {/* Center panel: main chat feed */}
      <main className="flex-1 flex flex-col bg-panel border-r border-borderStrong">
        <header className="px-4 py-3 border-b border-borderStrong flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Path</p>
            {/* Breadcrumbs will later reflect root → ... → activeNode */}
            <p className="text-sm text-gray-200">Main &rarr; Current branch</p>
          </div>
        </header>

        {/* Chat messages area – will later render the lineage only */}
        <section className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="text-xs text-gray-500">
            Chat lineage for the active node will appear here.
          </div>
        </section>

        {/* Input bar */}
        <footer className="border-t border-borderStrong p-3">
          <div className="flex items-end gap-2">
            <textarea
              className="flex-1 resize-none rounded-md bg-sidebar border border-borderStrong px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              rows={2}
              placeholder="Ask a question, or branch from a previous message…"
            />
            <button className="h-9 px-4 rounded-md bg-accent hover:bg-accentMuted text-sm font-medium transition-colors">
              Send
            </button>
          </div>
        </footer>
      </main>

      {/* Right panel: React Flow tree (visual branch navigator) */}
      <aside className="w-[380px] bg-sidebar flex flex-col">
        <div className="px-4 py-3 border-b border-borderStrong flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-gray-500">Tree</p>
          <p className="text-xs text-gray-400">Click a node to jump</p>
        </div>
        <div className="flex-1">
          {/* In the next step, this will be replaced by <ReactFlow /> */}
          <div className="h-full flex items-center justify-center text-xs text-gray-500">
            Conversation tree visualization will render here.
          </div>
        </div>
      </aside>
    </div>
  )
}

export default App
