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

// The starter tree: just the joke. Linear. The scroll demo then plays out a
// short, funny exchange -- a coy dodge, the user pushing back, and a real answer
// from a sharper model -- before branching a tangent off the original joke.
function seed(): MessageResponse[] {
  return [
    node('d0', null, 'user', 'Tell me a dad joke', 0),
    node('d1', 'd0', 'assistant', "Why don't eggs tell jokes? They'd crack each other up.", 1, 'groq', 'llama-3.3-70b')
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
  // 1) The coy dodge (fast model).
  { content: "Ha — you smiled though 😏. Do I really have to explain my own joke?", provider: 'groq', model: 'llama-3.3-70b' },
  // 2) The real answer, after the user pushes back -- from a sharper model.
  { content: 'My bad 😅 — okay, for real: it is a pun on "crack up." An egg can literally crack, and to crack up means to burst out laughing. Both meanings fire at once, and that is the joke.', provider: 'anthropic', model: 'claude-3-5-sonnet' },
  // 3) A deeper dig, branched off the original joke.
  { content: 'Going deeper: "crack" is the hinge of the pun. Physically an egg cracks; idiomatically people crack up. It works because both senses are active in the same breath.', provider: 'groq', model: 'llama-3.3-70b' }
];

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MockTracebackClient extends TracebackClient {
  private msgs: MessageResponse[] = seed();
  private replyIndex = 0;
  private counter = 0;

  constructor() {
    // A dummy base URL: the parent constructor builds an axios instance we never
    // actually call, because every method below is overridden.
    super('https://demo.local');
  }

  // Restore the starter tree so the scroll animation can replay from the top.
  reset(): void {
    this.msgs = seed();
    this.replyIndex = 0;
    this.counter = 0;
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
  signIn(): void {}
}
