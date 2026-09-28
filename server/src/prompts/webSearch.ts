// When a reply should NOT run a web search.
//
// OpenRouter's ":online" models search the web using the latest message alone,
// without the rest of the chat. For small talk ("hey"), follow-ups that only
// make sense in context ("no, not that one"), or questions about the assistant
// itself ("are you traceback?"), that search returns unrelated pages (the
// Python traceback module, other companies named traceback) and the model
// answers those pages instead of the conversation. Skipping the search for
// those messages lets the model answer from the chat.

const SMALL_TALK =
  /^(hi|hey|hello|yo|sup|hiya|thanks|thank you|thx|ty|ok|okay|k|cool|nice|great|awesome|lol|lmao|haha+|got it|sure|yes|yeah|yep|no|nope|nah|wow|bye|good night|gn|gm|good morning)\b[\s!.?,:)(]*$/i;

// Refinements of the previous turn, meaningless as a standalone search.
const FOLLOW_UP =
  /^(no|nope|nah|not that|not this|i mean|i meant|by .{1,20} i mean|that'?s not|what i mean|i was asking|i'?m asking|i'?m talking about)\b/i;

// Questions about the assistant itself.
const ABOUT_SELF =
  /\btraceback\b|\b(are|were) you\b|\bwho (made|built|created|designed|owns) you\b|\bwhat (model|llm) (are|is) (you|this)\b|\byourself\b|\bi mean (you|this app)\b/i;

// True when the message is worth a web search.
export function needsWebSearch(message: string): boolean {
  const text = message.replace(/^>.*$/gm, '').trim(); // ignore quoted passages
  if (!text) return false;
  if (SMALL_TALK.test(text)) return false;
  if (FOLLOW_UP.test(text)) return false;
  // "Are you ...?" about the assistant, unless it's clearly a request for
  // current facts ("can you check today's bitcoin price?").
  if (ABOUT_SELF.test(text) && !/\b(latest|today|current|news|price|weather|score|recent)\b/i.test(text)) return false;
  return true;
}

// The model to use for this message: the ":online" suffix is dropped when the
// message doesn't need a search.
export function modelForMessage(model: string, message: string): string {
  return model.endsWith(':online') && !needsWebSearch(message) ? model.slice(0, -':online'.length) : model;
}
