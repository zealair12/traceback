// Where the user's API keys live in the browser.
//
// Plain-English big picture:
// "Bring your own key" stores each backend's key in the browser's sessionStorage
// -- which is wiped when the tab closes, so a key never lingers in permanent
// storage. The key is read only to send it (in a header) with a request, and to
// show the user the last few characters so they can tell which key is saved. It
// is never written to a server, a database, or a log.

const PREFIX = 'traceback:key:';

export function getStoredKey(provider: string): string | null {
  try {
    return sessionStorage.getItem(PREFIX + provider);
  } catch {
    return null; // sessionStorage may be unavailable (e.g. server-side render)
  }
}

export function setStoredKey(provider: string, key: string): void {
  try {
    sessionStorage.setItem(PREFIX + provider, key);
  } catch {
    /* ignore */
  }
}

export function clearStoredKey(provider: string): void {
  try {
    sessionStorage.removeItem(PREFIX + provider);
  } catch {
    /* ignore */
  }
}

// A privacy-preserving hint for the UI: the last 4 characters only.
export function keyHint(key: string): string {
  return key.length <= 4 ? '••••' : '••••' + key.slice(-4);
}
