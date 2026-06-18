# Design: replace highlight + right-click with a selection popover

Date: 2026-06-10. Status: approved path (recommended option taken; user review at PR).

## Problem

Branching required selecting text in a reply and then RIGHT-CLICKING to get a
context menu. User feedback: "highlighting and right clicking is a bit
unnatural and not smooth." Right-click is an invisible, desktop-only gesture.

## Approaches considered

1. Selection popover only -- floating toolbar at the selection (the pattern
   from Medium, Notion, and ChatGPT's quote-reply).
2. Popover plus a hover "Branch" button on each reply, for forking from a
   point without selecting any text. (Chosen.)
3. Popover while also keeping right-click -- rejected: two code paths for a
   gesture already judged unnatural.

## Decision

- Selecting text in an assistant reply shows a small floating toolbar at the
  selection: Dig deeper, Ask about this, Copy. Placed above the selection,
  flipping below when too close to the window top. Dismissed when the
  selection collapses or an action is taken.
- Hovering an assistant reply reveals a subtle "Branch" button that enters
  branching mode anchored at that reply (existing "ask" mode with no snippet)
  and focuses the input.
- The right-click context menu is removed; the now-unused ContextMenu
  component is deleted.
- All existing branching logic is reused unchanged -- only the trigger surface
  changed. One robustness fix: the selected text is read from the Range rather
  than the Selection so it keeps working when the window lacks focus.

## Verification (live browser, the UI test harness)

- Selecting text in a reply shows the three-button toolbar.
- "Dig deeper" sends the quoted question as a new branch and dismisses the
  toolbar (confirmed: new user turn 'Explain this in more detail: "..."').
- The hover "Branch" button enters branching mode (banner "Branching from:
  ...") with the input focused.
- Type-check and production build clean after removing ContextMenu.
