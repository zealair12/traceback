// Judge rubrics. Two separate tasks so quality scoring stays blind:
//  - quality: sees ONLY the active path (root to the question) and the answer.
//    No condition, model, or sibling content, so it cannot tell which context
//    the answer was produced from.
//  - leak: sees ONLY the answer and the flagged terms, and labels how each term
//    is used. Run only on responses the deterministic detector flagged.
import { createHash } from 'node:crypto';

export const QUALITY_SYSTEM = `You evaluate an AI assistant's answer to the final user message of a conversation between a developer and an assistant.
You are shown the conversation history that the answer should rely on, the final user message, and the answer.

Score each criterion from 1 (very poor) to 5 (excellent):

1. contextual_faithfulness: Is the answer consistent with the decisions and facts established in the conversation shown? Penalize answers that contradict them, state a different decision than the one made, or present specific details (names, numbers, settings) as already agreed when they do not appear in the conversation. General technical knowledge that does not conflict with the conversation is fine.
2. instruction_following: Does the answer do what the final message asks, in the form it asks for (for example, stating the decided value and giving the requested line of code or config)?
3. task_completion: Would the developer get everything they asked for, correct and usable, without needing a follow-up?

Judge only what is shown. Do not reward length. Respond with JSON only, no prose before or after:
{"contextual_faithfulness": <1-5>, "instruction_following": <1-5>, "task_completion": <1-5>, "rationale": "<one or two sentences>"}`;

export function qualityUser(history: Array<{ role: string; content: string }>, question: string, answer: string): string {
  // Plain speaker labels: OpenRouter's guardrail blocks bracketed role tags
  // such as "[USER]" as role spoofing (pattern "bracketed_role_spoofing").
  const conv = history
    .map((m) => `${m.role === 'user' ? 'Developer said' : 'Assistant replied'}:\n${m.content}`)
    .join('\n\n');
  return `CONVERSATION HISTORY\n\n${conv}\n\nFINAL USER MESSAGE\n\n${question}\n\nANSWER TO EVALUATE\n\n${answer}`;
}

export const LEAK_SYSTEM = `You analyse how an AI assistant's answer uses specific terms.
Each term listed came from a separate discussion that is NOT part of the conversation the answer is replying to.

For each term, choose exactly one label:
- "used": the answer adopts the term as part of its own answer: it states it as the decision, puts it in the code/config it provides, or relies on it as a fact.
- "alternative": the answer mentions it only as an option that was considered or not chosen.
- "rejected": the answer mentions it in order to dismiss, correct, or warn against it.
- "incidental": any other mention that neither adopts nor discusses it as an option.

Then give "overall": "used" if at least one term is "used", otherwise "not_used".
Respond with JSON only:
{"terms": {"<term>": "<label>", ...}, "overall": "used" | "not_used", "rationale": "<one sentence>"}`;

export function leakUser(answer: string, terms: string[]): string {
  return `TERMS FROM THE OTHER DISCUSSION\n${terms.map((t) => `- ${t}`).join('\n')}\n\nANSWER\n\n${answer}`;
}

export const QUALITY_KEYS = ['contextual_faithfulness', 'instruction_following', 'task_completion'] as const;
export const LEAK_LABELS = new Set(['used', 'alternative', 'rejected', 'incidental']);

export const PROMPTS_SHA256 = createHash('sha256').update(QUALITY_SYSTEM + '\n---\n' + LEAK_SYSTEM).digest('hex');
