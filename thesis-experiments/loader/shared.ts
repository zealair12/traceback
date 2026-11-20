// Shared naming and clock rules for loading scenarios into Traceback tables.
import type { Scenario } from '../lib/types.js';

export const SESSION_PREFIX = 'exp-';
export const EXP_USER = { googleId: 'thesis-experiment-loader', email: 'thesis-experiment@traceback.invalid', name: 'Thesis experiment' };
// Logical clock -> createdAt. One tick = one minute from a fixed base, so the
// sliding window and the UI see the designed order.
export const BASE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
export const TICK_MS = 60_000;
export const sessionId = (s: Scenario) => `${SESSION_PREFIX}${s.id}`;
export const messageId = (s: Scenario, mid: string) => `${SESSION_PREFIX}${s.id}-${mid}`;
export const createdAtOf = (t: number) => new Date(BASE_TIME_MS + t * TICK_MS);

export function depthMap(s: Scenario): Map<string, number> {
  const byId = new Map(s.messages.map((m) => [m.id, m]));
  const depth = new Map<string, number>();
  const d = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const m = byId.get(id)!;
    const v = m.parent === null ? 0 : d(m.parent) + 1;
    depth.set(id, v);
    return v;
  };
  s.messages.forEach((m) => d(m.id));
  return depth;
}
