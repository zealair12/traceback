// A no-network, scripted stand-in for TracebackClient, used by the landing-page
// demo so the REAL chat UI runs on canned data.
//
// Plain-English big picture:
// The landing page shows the actual Traceback app on a laptop screen -- not a
// screenshot. To do that without a server, we hand the real app this fake
// "client". It answers every call the app makes (load providers, load the
// conversation, send a message) instantly from memory, and streams a canned
// reply word by word so the typing animation looks real. Because it extends the
// real client class, the app cannot tell the difference -- so the demo can never
// drift out of sync with the product: it IS the product, on scripted data.

import {
  TracebackClient,
  type SessionResponse,
  type MessageResponse,
  type ProvidersResponse,
  type AuthMeResponse,
  type SendMessageResult
} from '@traceback/shared';

const SESSION_ID = 'demo-session';
const stamp = (i: number) => new Date(Date.UTC(2024, 0, 1, 12, 0, i)).toISOString();

function node(
  id: string,
  parentId: string | null,
  role: 'user' | 'assistant',
  content: string,
  depth: number,
  provider: string | null = null,
  model: string | null = null
): MessageResponse {
  return {
    id,
    sessionId: SESSION_ID,
    parentId,
    role,
    content,
    depth,
    branchLabel: null,
    attachments: null,
    provider: role === 'assistant' ? provider : null,
    model: role === 'assistant' ? model : null,
    createdAt: stamp(depth)
  };
}

// The starter tree: a question and a rambly first answer. The scroll demo then
// plays out a short exchange (the user laughs to refocus it, then a sharper model
// nails the answer) before branching off into gullible questions on the topic.
function seed(): MessageResponse[] {
  return [
    node('d0', null, 'user', 'If people on the basketball court call me washed, what does this mean?', 0),
    node('d1', 'd0', 'assistant', 'Oh, washed is a classic bit of court talk. It pulls from a whole world of playground slang, the old streetball mixtapes, the trash talk that gets handed down from run to run, and honestly the roots of it go back further than most people realize into...', 1, 'groq', 'llama-3.3-70b')
  ];
}

// Canned assistant replies, in the order the demo triggers them. Each carries
// the model that "answered" it, so the provenance badge visibly changes when the
// demo switches to a sharper model for the real answer.
interface ScriptedReply {
  content: string;
  provider: string;
  model: string;
}
const REPLIES: ScriptedReply[] = [
  // 1) Refocused answer after the user laughs.
  { content: 'Ha, fair. Straight answer: being called washed means people think your best playing days are behind you. It is a friendly jab that you have lost a step.', provider: 'groq', model: 'llama-3.3-70b' },
  // 2) The sharper take, from a stronger model.
  { content: 'Mostly it is lighthearted trash talk between people who hoop together, not a real insult. Tone and context carry it. A teammate grinning while they say it is pure banter. A stranger saying it flat can sting a little more.', provider: 'anthropic', model: 'claude-3-5-sonnet' },
  // 3) The gullible branch off the original question.
  { content: 'Ha, no, nothing to do with soap or showers. Washed is only about your game slipping, never your hygiene. You are good on the smell front.', provider: 'groq', model: 'llama-3.3-70b' }
];

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MockTracebackClient extends TracebackClient {
  private msgs: MessageResponse[] = seed();
  private replyIndex = 0;
  private counter = 0;
  // Where the pulsing "Sign in with Google" button sends the visitor: the real
  // backend's Google auth. Empty means no-op (safe default).
  private authUrl: string;

  constructor(authUrl = '') {
    // A dummy base URL: the parent constructor builds an axios instance we never
    // actually call, because every method below is overridden.
    super('https://demo.local');
    this.authUrl = authUrl;
  }

  // Restore the starter tree so the scroll animation can replay from the top.
  reset(): void {
    this.msgs = seed();
    this.replyIndex = 0;
    this.counter = 0;
  }

  // Rebuild the whole conversation to the state at a given scroll step, and
  // return the node that should be active (shown) at that step. Deterministic,
  // so scrolling up and down always lands on the same branch state:
  //   0: just the joke
  //   1: + "Explain it" -> a coy dodge
  //   2: + "yo, answer the question" -> the real answer from a sharper model
  //   3: + a branch off the original joke (the tree forks)
  buildTo(step: number): string {
    const msgs = seed();
    let c = 0;
    const add = (parentId: string, userText: string, reply: ScriptedReply): string => {
      const parent = msgs.find((m) => m.id === parentId);
      const ud = (parent?.depth ?? -1) + 1;
      c += 1;
      const u = node(`bu${c}`, parentId, 'user', userText, ud);
      const a = node(`ba${c}`, u.id, 'assistant', reply.content, ud + 1, reply.provider, reply.model);
      msgs.push(u, a);
      return a.id;
    };
    let leaf = 'd1';
    let active = 'd1';
    if (step >= 1) { leaf = add('d1', '😂', REPLIES[0]); active = leaf; }
    if (step >= 2) { leaf = add(leaf, 'So is it an insult or a joke?', REPLIES[1]); active = leaf; }
    if (step >= 3) { active = add('d1', 'Wait, does washed mean they think I forgot to shower before the game?', REPLIES[2]); }
    this.msgs = msgs;
    return active;
  }

  private session(): SessionResponse {
    return { id: SESSION_ID, name: 'Dad jokes', createdAt: stamp(0), updatedAt: stamp(9) };
  }

  // Add a user turn and its scripted assistant reply under the given parent.
  private appendTurn(content: string, parentId: string | null) {
    const parent = parentId ? this.msgs.find((m) => m.id === parentId) ?? null : null;
    const userDepth = (parent?.depth ?? -1) + 1;
    this.counter += 1;
    const user = node(`u${this.counter}`, parentId, 'user', content, userDepth);
    const reply: ScriptedReply =
      REPLIES[this.replyIndex] ?? { content: 'Here is another angle on that.', provider: 'groq', model: 'llama-3.3-70b' };
    this.replyIndex += 1;
    const asst = node(`a${this.counter}`, user.id, 'assistant', reply.content, userDepth + 1, reply.provider, reply.model);
    this.msgs.push(user, asst);
    return { user, asst };
  }

  async fetchCurrentUser(): Promise<AuthMeResponse> {
    return { isGuest: true, dailyLimit: 5, messagesUsedToday: 0 };
  }

  async fetchProviders(): Promise<ProvidersResponse> {
    return {
      default: 'demo',
      providers: [
        {
          id: 'demo',
          defaultModel: 'traceback',
          suggestedModels: ['traceback'],
          visionModels: [],
          documentModels: [],
          configured: true
        }
      ]
    };
  }

  async fetchSessions(): Promise<SessionResponse[]> {
    return [this.session()];
  }

  async createSession(): Promise<SessionResponse> {
    return this.session();
  }

  async updateSessionName(): Promise<SessionResponse> {
    return this.session();
  }

  async autoNameSession(): Promise<SessionResponse> {
    return this.session();
  }

  async fetchSessionMessages(): Promise<MessageResponse[]> {
    // A copy so the app's state updates never mutate our store by reference.
    return this.msgs.map((m) => ({ ...m }));
  }

  // Stream a canned reply word by word, so the real typing animation plays.
  async sendMessageStream(
    _sessionId: string,
    content: string,
    parentId: string | null,
    _opts: unknown,
    handlers: {
      onToken: (chunk: string) => void;
      onDone: (result: { userMessage: MessageResponse; assistantMessage: MessageResponse }) => void;
    }
  ): Promise<void> {
    const { user, asst } = this.appendTurn(content, parentId);
    const words = asst.content.split(' ');
    for (let i = 0; i < words.length; i++) {
      await wait(26);
      handlers.onToken((i === 0 ? '' : ' ') + words[i]);
    }
    handlers.onDone({ userMessage: user, assistantMessage: asst });
  }

  async sendMessage(
    _sessionId: string,
    content: string,
    parentId: string | null
  ): Promise<SendMessageResult> {
    const { user, asst } = this.appendTurn(content, parentId);
    return { userMessage: user, assistantMessage: asst, lineage: [] };
  }

  // Everything else the app may call: harmless no-ops for the demo.
  async deleteSession(): Promise<void> {}
  async deleteSubtree(): Promise<void> {}
  async importConversations() {
    return { imported: [] };
  }
  async transcribeAudio() {
    return { text: '', provider: 'demo', model: 'demo' };
  }
  async signOut(): Promise<void> {}
  // The demo's one real action: start Google sign-in on the live backend.
  signIn(): void {
    if (this.authUrl) window.location.href = this.authUrl;
  }
}
