# Design: multimodality (images, speech) and Auto model routing

Date: 2026-06-10. Status: recommended path taken after design presentation;
user review at PR. Icon decision made by user: branch inside a round chat
bubble.

## Scope decisions

- Images: in. Attach via paperclip or paste; stored on the message; delivered
  to image-capable models in each provider's own format.
- Speech: in, as transcription (phase 3). Mic recording and audio files are
  transcribed to text (Whisper on Groq, OpenAI fallback) and dropped into the
  input. No text-to-speech.
- Video: deliberately deferred. No connected provider takes video through the
  chat path; revisit when one does.

## Image pipeline

- Storage: nullable `attachments` JSON column on Message; a list of
  { type: "image", mediaType, dataUrl } with bytes inline as base64 data URLs
  (self-contained for a local-first app). Bounded at the API: max 4 images per
  message, ~6MB each, image/* only.
- Neutral shape: LlmMessage gains optional `images`. Text-only turns remain
  plain strings end to end (zero churn for the existing path).
- Provider dialects: Groq/OpenAI/local get content-parts lists with image_url
  data URLs (shared mapper in providers/imageContent.ts); Anthropic gets
  image source blocks with the base64 payload (data URL prefix stripped).
- Context: the lineage CTE carries attachments, so images attached anywhere on
  the pruned path travel with their turn in later requests.

## Capability metadata

Each provider declares `visionModels` (which of its models accept images),
exposed through /providers. Groq: the Llama 4 multimodal models; OpenAI:
gpt-4o / gpt-4o-mini; Anthropic: all current Claude chat models; local:
operator-named via LOCAL_VISION_MODELS (empty by default).

## Auto routing

"Auto" is the first entry in the model picker. Resolution happens IN THE
CLIENT, not the server, because BYOK keys are sent per-request for a specific
provider -- the client knows which backends are usable (server-configured or
user-keyed) and what they can see. Rules, deterministic and explainable:

- message has images -> first usable backend with a vision model, in the order
  groq, openai, anthropic, local; its first vision model is used.
- plain text -> the server's default backend if usable, else the first usable.

Auto only ever picks from connected models, and the resolved choice lands in
the message's provenance badge so the user always sees what Auto did.

## Verification

server/scripts/verify-multimodal.ts (mock model records what it receives):
vision metadata advertised; image message stored AND delivered as text+image
parts with the exact data URL; later turns keep earlier images in context;
size/type/count validation rejects bad input. Verified live in the browser:
attach -> chip -> send under Auto -> badge shows the vision model; plain text
under Auto -> badge shows the default model.
