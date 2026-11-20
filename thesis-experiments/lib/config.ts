import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import YAML from 'yaml';
import type { SiblingType, Recency, FactPosition } from './types.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface ExperimentConfig {
  seed: number;
  design: {
    depths: number[];
    sibling_counts: number[];
    sibling_exchanges: number;
    types: SiblingType[];
    recency: Recency[];
    fact_position: FactPosition[];
    instances_per_cell: number;
  };
  generation: { fork: 'half_depth'; filler: 'template' | 'llm' };
  tokens: {
    reference_encoding: string;
    target: { user: [number, number]; assistant: [number, number] };
    band: { user: [number, number]; assistant: [number, number] };
  };
}

export function loadConfig(path = join(ROOT, 'config/experiment.yaml')): ExperimentConfig {
  return YAML.parse(readFileSync(path, 'utf8')) as ExperimentConfig;
}
