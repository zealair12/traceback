// Translate neutral messages into the OpenAI-dialect wire format.
//
// Plain-English: text-only turns stay as plain strings (what every backend has
// always received). A turn with images becomes the dialect's "content parts"
// list: the text part followed by one image part per attachment, with the
// image bytes already inline as a base64 data URL. Groq, OpenAI, and local
// OpenAI-compatible servers all accept this same shape.

import type { LlmMessage } from './types.js';

export function toOpenAiDialectMessages(messages: LlmMessage[]): Array<{
  role: 'user' | 'assistant' | 'system';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}> {
  return messages.map((m) =>
    m.images && m.images.length > 0
      ? {
          role: m.role,
          content: [
            { type: 'text', text: m.content },
            ...m.images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } }))
          ]
        }
      : { role: m.role, content: m.content }
  );
}
