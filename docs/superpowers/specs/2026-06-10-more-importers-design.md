# Design: claude.ai and Gemini importers

Date: 2026-06-10. Status: approved path (recommended option taken; user review at PR).

## Problem

Traceback imports ChatGPT exports and Claude Code sessions, but not the other
two major sources of personal chat history: the claude.ai web app and Gemini.

## Decision

Add two parser plugins behind the existing `ConversationImporter` contract.
No server or UI changes beyond one registry line each and a one-line panel
text update.

- `claude-ai`: parses the claude.ai data export (Settings >> Privacy >> Export
  data; zip contains conversations.json). Shape: array of conversations, each
  with a `chat_messages` list whose entries carry `sender: human|assistant`,
  text (in `content` blocks or a bare `text` field), and timestamps; some
  exports record the conversation's model. Linear -- imports as chains. The
  conversation-level model is recorded on assistant replies (provider
  `anthropic`) for provenance badges.
- `gemini`: parses Gemini history from Google Takeout (My Activity >> Gemini
  Apps; the "Gemini" product itself only exports Gems configuration). Shape:
  turns with `role: user|model`, `text`, `create_time`. Takeout wrapping has
  varied over time, so the parser accepts the known variants: a
  `conversations` array, and a bare list of turns. `model` maps to assistant,
  provider `google`; Takeout does not record which Gemini model answered, so
  no model badge.

Registry order: chatgpt, claude-code, claude-ai, gemini, generic (most
specific first; detection signatures do not overlap).

## Honest limitation

Both parsers are built and tested against the documented export shapes
(synthetic fixtures), not yet against real export files. When real exports are
in hand, confirmation is one drag-and-drop; format drift is a one-file parser
fix.

## Verification

TDD: fixtures and failing assertions were added to
`server/scripts/verify-import.ts` first (confirmed failing for the right
reason), then the parsers were written to make them pass. Assertions cover:
detection, conversation naming, chain structure (each parent is the previous
message), role mapping (human/model -> user/assistant), provenance, the
claude.ai bare-text fallback, and the Gemini flat-array variant.
