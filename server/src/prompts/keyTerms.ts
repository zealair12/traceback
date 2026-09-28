// Asks the model to mark a few key terms so the app can show Wikipedia-style
// hover previews for them. Only replies shown in the traceback app get this
// instruction; the OpenAI-compatible proxy does not, so outside apps never
// receive the term: markup.
export const KEY_TERMS_PROMPT =
  'Key terms: when a reply explains a topic, mark the 2 to 5 most useful specific terms a reader might want to look up ' +
  '(people, places, works, organizations, events, technical concepts) as a markdown link whose target is term: followed by the ' +
  'English Wikipedia article title with spaces written as underscores, for example [latency](term:Latency_(engineering)) or ' +
  '[Jimmy Warden](term:Jimmy_Warden). Mark each term once, at its first mention. Never mark inside code, headings, or existing ' +
  'links, never mark ordinary everyday words, and skip this entirely for short or casual replies.';
