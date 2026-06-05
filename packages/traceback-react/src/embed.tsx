// Standalone widget entry: lets ANY website embed Traceback without using React.
//
// Plain-English big picture:
// This builds into a single self-contained JavaScript file (with React bundled
// in) plus one CSS file. A plain web page can include them and then either:
//   - drop a <traceback-chat api-url="..."></traceback-chat> tag, or
//   - call Traceback.mount(element, { apiUrl: "..." }) from a script.
// Both render the full chat UI into the page. This is the "no build step,
// works anywhere" path that complements the React component and the headless hook.

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TracebackChat } from './TracebackChat.js';
import './embed.css';

export interface MountOptions {
  apiUrl: string;
}

// Render the chat UI into a host element. Returns an unmount function.
export function mount(element: HTMLElement, options: MountOptions): () => void {
  // The UI fills its container, so make sure the host has a size.
  if (!element.style.height) element.style.height = '100%';
  const root: Root = createRoot(element);
  root.render(createElement(TracebackChat, { apiUrl: options.apiUrl }));
  return () => root.unmount();
}

// A custom element so people can write <traceback-chat api-url="..."></traceback-chat>.
class TracebackChatElement extends HTMLElement {
  private unmount?: () => void;

  connectedCallback() {
    const apiUrl = this.getAttribute('api-url') ?? 'http://localhost:4000';
    this.style.display = 'block';
    if (!this.style.height) this.style.height = '100%';
    this.unmount = mount(this, { apiUrl });
  }

  disconnectedCallback() {
    this.unmount?.();
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('traceback-chat')) {
  customElements.define('traceback-chat', TracebackChatElement);
}

export { TracebackChat };
