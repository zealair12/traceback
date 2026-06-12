// Translate neutral messages into the OpenAI-dialect wire format.
//
// Plain-English: text-only turns stay as plain strings (what every backend has
// always received). A turn with images becomes the dialect's "content parts"
// list: the text part followed by one image part per attachment, with the
// image bytes already inline as a base64 data URL. Groq, OpenAI, and local
// OpenAI-compatible servers all accept this same shape.

import type { LlmMessage } from './types.js';

export function toOpenAiDialectMessages(
  messages: LlmMessage[],
  options?: { supportsFiles?: boolean }
): Array<{
  role: 'user' | 'assistant' | 'system';
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
        file?: { filename: string; file_data: string };
      }>;
}> {
  return messages.map((m) => {
    const hasImages = !!m.images?.length;
    const hasFiles = !!m.files?.length;
    if (hasFiles && options?.supportsFiles === false) {
      // Better a clear sentence than a cryptic upstream rejection.
      throw new Error(
        'This model cannot read document attachments. Pick an OpenAI or Anthropic model (or use Auto).'
      );
    }
    if (!hasImages && !hasFiles) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        { type: 'text', text: m.content },
        ...(m.images ?? []).map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
        ...(m.files ?? []).map((f) => ({
          type: 'file',
          file: { filename: f.name ?? 'document.pdf', file_data: f.dataUrl }
        }))
      ]
    };
  });
}
