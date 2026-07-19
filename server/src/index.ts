// Server entry point.
//
// Plain-English: load the private configuration (.env) first, build the app, and
// start listening. The app itself is assembled in app.ts so it can also be
// imported by tests without starting a server.
import 'dotenv/config';
import { createApp } from './app.js';

const app = createApp();
const port = process.env.PORT ?? 4000;

app.listen(port, () => {
  console.log(`traceback server listening on http://localhost:${port}`);
});
