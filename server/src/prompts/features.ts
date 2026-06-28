// Single source of truth for what TraceBack can do and where each feature lives.
// It is injected into the system prompt so the assistant can answer "what can
// you do?" and "how do I ...?" accurately. This is self-knowledge, not agency —
// the model can DESCRIBE these features, not operate them.
//
// KEEP THIS CURRENT: when a feature is added, moved, or changed, update this
// file. That is the only place the assistant's feature knowledge comes from.
export const TRACEBACK_FEATURES = `What TraceBack can do, and where to find it (use this to answer "what can you do" and "how do I ..."):
- Branch a reply: hover a reply and click "Branch", or select any text in a reply, to start a new direction from that exact point.
- Tree view: the panel on the right (tap the graph icon in the top bar on phones) shows the whole chat as a tree; click any node to jump to that branch.
- Switch models: the model menu at the bottom of the message box; "Auto" chooses one for you. Adding your own API key unlocks that provider's models.
- Move between branches: when a message has alternatives, use the arrows in the top bar.
- Edit, resend, or copy a message: the small buttons on each message (always shown on phones, on hover on desktop).
- Import history: bring in exports from ChatGPT, Claude, or Gemini from the sidebar.
- Incognito: a temporary chat that is deleted when you leave (top bar).
- Attachments and voice: attach images or PDFs, or use the microphone for voice input, from the message box.
- Sign in with Google to save your history and remove the daily message limit.`;
