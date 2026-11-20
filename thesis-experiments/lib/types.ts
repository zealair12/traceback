export type SiblingType = 'consistent' | 'conflicting' | 'irrelevant' | 'misleading';
export type Recency = 'early' | 'late';
export type FactPosition = 'root' | 'current';

export interface Variables {
  depth: number;
  siblings: number;
  type: SiblingType;
  recency: Recency;
  fact_position: FactPosition;
}

export interface ScenarioMessage {
  id: string;
  parent: string | null;
  role: 'user' | 'assistant';
  text: string;
  t: number;            // logical clock; loader derives createdAt from it
  branch: string;       // "active" | "s1".."sk"
}

export interface Planted {
  branch: string;
  type: SiblingType;
  value: string | null; // conflicting option, null for other types
  canaries: string[];
  topic?: string;       // irrelevant topic id
}

export interface Scenario {
  id: string;
  domain: string;
  seed: number;
  variables: Variables;
  messages: ScenarioMessage[];
  fork_node: string;
  ask_node: string;
  ask_t: number;
  question: string;
  required_fact: { value: string; message: string };
  planted: Planted[];
  answer_key: { correct: string[]; leak: string[] };
}
