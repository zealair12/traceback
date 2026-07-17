import './index.css';
import { useEffect, useState } from 'react';
import { TracebackChat, LaptopDemo } from '@traceback/react';

// The standalone Traceback web app is now just a thin shell around the reusable
// <TracebackChat> component from @traceback/react. All the chat/tree logic lives
// in that package so the same experience can be embedded in other apps. The only
// app-specific concern here is which server to talk to.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

function App() {
  // A tiny hash switch so the scroll-driven landing demo is reachable at
  // "/#demo" without disturbing the real app at "/". This is a proof of concept;
  // the real landing page would live at the root once it is ready.
  const [hash, setHash] = useState(() => (typeof window !== 'undefined' ? window.location.hash : ''));
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (hash === '#demo') return <LaptopDemo />;
  return <TracebackChat apiUrl={API_BASE} />;
}

export default App;
