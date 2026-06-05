# @traceback/react

The Traceback tree-chat experience, packaged for reuse. Conversations are stored
as a branching tree on a Traceback server; this package renders that experience
and talks to the server for you. There are three ways to use it, from "just works"
to "build your own".

All three need a running Traceback server (see the `server/` directory). Point
them at its URL.

## 1. Standard UI (React)

Render the whole experience -- sidebar, chat, and branching tree -- with one tag:

```tsx
import { TracebackChat } from '@traceback/react';
import '@traceback/react/styles.css'; // markdown/math/tree styles

export default function App() {
  return <TracebackChat apiUrl="http://localhost:4000" />;
}
```

Your app also needs Tailwind set up with the colour theme tokens and a `@source`
pointing at this package (see `client/src/index.css` for a working example).

## 2. Headless (build your own UI)

`useTraceback` holds all the logic (sessions, the branching tree, sending to a
chosen model, navigation) and returns plain data + actions. Render whatever you
like around it:

```tsx
import { useTraceback } from '@traceback/react';

function MyChat() {
  const tb = useTraceback({ apiUrl: 'http://localhost:4000' });
  return (
    <div>
      {tb.threadPath.map((m) => <p key={m.id}><b>{m.role}:</b> {m.content}</p>)}
      <button onClick={() => tb.handleSendMessage('Hello')}>Send</button>
    </div>
  );
}
```

## 3. Drop-in widget (any website, no build step)

Build the standalone bundle (`npm run build:lib`), then on any HTML page include
the produced CSS + JS and use the custom element (React is bundled in):

```html
<link rel="stylesheet" href="traceback-widget/react.css" />
<traceback-chat api-url="http://localhost:4000"></traceback-chat>
<script src="traceback-widget/traceback-widget.js"></script>
```

Or mount it from script: `Traceback.mount(document.getElementById('chat'), { apiUrl: 'http://localhost:4000' })`.

A runnable example is in `examples/embed.html`.

> Note: the widget CSS currently inlines the KaTeX math fonts, which makes it
> large. If you do not need math rendering, or prefer separate font files, that
> is a known optimization to do next.
