// How replies cite sources: as links on the relevant words of a sentence, not
// as a site's name or domain. Used in the system prompt AND as OpenRouter's web
// search prompt, whose default tells the model to name links by domain
// ("[nytimes.com](...)"), which is why links used to read "en.wikipedia.org".
export const CITATION_RULE =
  'Cite a source by turning the relevant words of your own sentence into a markdown link to that exact page, for example: ' +
  'light travels at [about 300,000 km per second](https://example.com/speed-of-light). Never use a website\'s name or domain ' +
  '(such as en.wikipedia.org) as link text, never write a source as bare bracketed text like [example.com], and do not add a ' +
  'separate list of sources.';

export const WEB_SEARCH_PROMPT =
  'A web search was run for this message. Use the results below for current facts. ' + CITATION_RULE;

// OpenRouter's ":online" models run its web plugin; this swaps in our citation
// style. Other OpenAI-compatible APIs reject unknown fields, so it is only sent
// to OpenRouter, and only when web search is already on.
export function openRouterWebPlugin(model: string | undefined, baseURL: string | undefined): object {
  if (!model?.endsWith(':online') || !baseURL?.includes('openrouter.ai')) return {};
  return { plugins: [{ id: 'web', search_prompt: WEB_SEARCH_PROMPT }] };
}
