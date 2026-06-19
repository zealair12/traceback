// Where the user's API keys live in the browser -- as a plain object.
//
// Plain-English big picture:
// "Bring your own key" stores each backend's key in localStorage so it
// survives page refreshes and new tabs. A key is read only to send it (in a
// header) with a request, and to show the user its last few characters. It
// never reaches a database or a log.

export class KeyStore {
  private readonly prefix: string;

  constructor(prefix = 'traceback:key:') {
    this.prefix = prefix;
  }

  get(provider: string): string | null {
    try {
      return localStorage.getItem(this.prefix + provider);
    } catch {
      return null; // localStorage may be unavailable (e.g. private mode)
    }
  }

  set(provider: string, key: string): void {
    try {
      localStorage.setItem(this.prefix + provider, key);
    } catch {
      /* ignore */
    }
  }

  clear(provider: string): void {
    try {
      localStorage.removeItem(this.prefix + provider);
    } catch {
      /* ignore */
    }
  }

  // A privacy-preserving hint for the UI: the last 4 characters only.
  hint(key: string): string {
    return key.length <= 4 ? '••••' : '••••' + key.slice(-4);
  }

  // Which of these backends have a key saved in this tab.
  keyedAmong(providerIds: string[]): Set<string> {
    return new Set(providerIds.filter((id) => this.get(id)));
  }
}

// The app-wide store. Embedders wanting a different prefix can construct
// their own.
export const keyStore = new KeyStore();
