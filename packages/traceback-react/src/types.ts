// UI-facing types for the Traceback chat components.

import type { MessageResponse } from '@traceback/shared';

// One message as shown in the chat thread: the slice of the server's message
// the bubbles need to render. Deriving it from MessageResponse means the two
// can never drift apart.
export type ChatMessage = Pick<
  MessageResponse,
  'id' | 'role' | 'content' | 'provider' | 'model' | 'attachments' | 'branchLabel'
>;
