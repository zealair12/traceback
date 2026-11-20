// Reference tokenizer: one fixed encoding for budgeting across all models.
// Real per-model usage is recorded separately by the runner.
import { getEncoding, type TiktokenEncoding } from 'js-tiktoken';

const cache = new Map<string, ReturnType<typeof getEncoding>>();

export function countTokens(text: string, encoding: string = 'o200k_base'): number {
  let enc = cache.get(encoding);
  if (!enc) {
    enc = getEncoding(encoding as TiktokenEncoding);
    cache.set(encoding, enc);
  }
  return enc.encode(text).length;
}
