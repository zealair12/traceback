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
  depth: number
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
    provider: role === 'assistant' ? 'demo' : null,
    model: role === 'assistant' ? 'traceback' : null,
    createdAt: stamp(depth)
  };
}

// The starter tree: one dad joke, then a follow-up that explains it. Linear.
// The scroll demo later branches a SECOND reply off the joke, forking the tree.
function seed(): MessageResponse[] {
  return [
    node('d0', null, 'user', 'Tell me a dad joke', 0),
    node('d1', 'd0', 'assistant', "Why don't eggs tell jokes? They'd crack each other up.", 1),
    node('d2', 'd1', 'user', 'Explain it', 2),
    node(
      'd3',
      'd2',
      'assistant',
      'It is a pun on "crack up": an egg can literally crack, and to crack up means to burst out laughing. Both meanings land at once, which is what makes it a pun.',
      3
    )
  ];
}

// Canned assistant replies, picked in order as the demo sends messages.
const REPLIES = [
  'Here is a different take: dad jokes lean on puns because the surprise comes from a word meaning two things at once. Same setup, brand-new punchline.',
  'Good branch to explore. Notice how this stays a separate line of thought -- your original thread is untouched, so you can compare both answers side by side.'
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
    const replyText = REPLIES[this.replyIndex % REPLIES.length];
    this.replyIndex += 1;
    const asst = node(`a${this.counter}`, user.id, 'assistant', replyText, userDepth + 1);
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
