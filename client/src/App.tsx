import './index.css';
import { TracebackChat, LaptopDemo } from '@traceback/react';

// The standalone Traceback web app. All the chat/tree logic lives in the
// @traceback/react package; this shell only picks which page to show and which
// server to talk to.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

// One domain, two pages (sustainable path routing, not a hash hack):
//   /      -> the landing (the homepage, how you enter)
//   /app   -> the real app (requires sign-in)
// Moving between them happens through full-page redirects (sign in, sign out),
// so we just read the path on load. A Vercel rewrite serves index.html for every
// path so /app does not 404 on a direct visit or refresh.
function App() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const isApp = path === '/app' || path.startsWith('/app/');
  if (isApp) return <TracebackChat apiUrl={API_BASE} requireAuth />;
  return <LaptopDemo authUrl={`${API_BASE}/auth/google`} />;
}

export default App;
