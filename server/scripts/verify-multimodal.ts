// End-to-end check of image attachments and vision metadata, no API key needed.
//
// Plain-English: this proves the multimodal pipeline against a fake
// OpenAI-style model server that records exactly what it receives:
//   1. /providers advertises which models can see images (vision metadata).
//   2. A message with an attached image is stored with the image AND the model
//      receives the image alongside the text (as content parts).
//   3. A plain text message still goes out the old way (a simple string).
//   4. A later turn in the same conversation still carries the earlier image
//      in its context (images travel with the pruned lineage).
//   5. Oversized or malformed attachments are rejected clearly.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(__dirname, '..', 'src', 'index.ts');

// A 1x1 transparent PNG, the smallest real image there is.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function startMockModelServer(): Promise<{
  port: number;
  lastBody: () => any;
  close: () => void;
}> {
  let lastBody: any = null;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        try {
          lastBody = JSON.parse(raw || '{}');
        } catch {
          lastBody = null;
        }
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'seen' } }] })
        );
      });
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: (server.address() as any).port, lastBody: () => lastBody, close: () => server.close() })
    );
  });
}

async function waitForHealth(base: string, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not become healthy in time.');
}

async function main() {
  const mock = await startMockModelServer();
  const PORT = 4559;
  const base = `http://127.0.0.1:${PORT}`;
  const child = spawn('npx', ['tsx', serverEntry], {
    cwd: join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      LLM_PROVIDER: 'local',
      LOCAL_BASE_URL: `http://127.0.0.1:${mock.port}/v1`,
      LOCAL_VISION_MODELS: 'test-vision',
      LOCAL_DOCUMENT_MODELS: 'test-doc'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  const cleanup = () => {
    child.kill('SIGTERM');
    mock.close();
  };

  try {
    await waitForHealth(base);

    // 1. Vision metadata is advertised.
    const providers = await fetch(`${base}/providers`).then((r) => r.json());
    const local = providers.providers.find((p: any) => p.id === 'local');
    console.log('local visionModels:', JSON.stringify(local?.visionModels));

    // 2. Send a message WITH an image.
    const session = await fetch(`${base}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'multimodal-test' })
    }).then((r) => r.json());

    const attachment = { type: 'image', mediaType: 'image/png', dataUrl: TINY_PNG };
    const send1 = await fetch(`${base}/message/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'What is in this image?',
        provider: 'local',
        model: 'test-vision',
        attachments: [attachment]
      })
    });
    const send1Body = await send1.json();
    const seen1 = mock.lastBody();
    const imageTurn = (seen1?.messages ?? []).find((m: any) => Array.isArray(m.content));
    const imagePart = imageTurn?.content?.find((p: any) => p.type === 'image_url');
    console.log('image send status:', send1.status);
    console.log('model received content parts:', imageTurn ? imageTurn.content.length : 0);
    console.log('image part url matches:', imagePart?.image_url?.url === TINY_PNG);
    console.log(
      'stored attachments roundtrip:',
      Array.isArray(send1Body.userMessage?.attachments) && send1Body.userMessage.attachments.length === 1
    );

    // 3. A plain-text follow-up still carries the earlier image in context.
    const send2 = await fetch(`${base}/message/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        parent_id: send1Body.assistantMessage.id,
        content: 'And one more question.',
        provider: 'local',
        model: 'test-vision'
      })
    });
    const seen2 = mock.lastBody();
    const lineageImageTurns = (seen2?.messages ?? []).filter((m: any) => Array.isArray(m.content));
    const lineagePlainTurns = (seen2?.messages ?? []).filter((m: any) => typeof m.content === 'string');
    console.log(
      'follow-up status:',
      send2.status,
      '| image turns in context:',
      lineageImageTurns.length,
      '| plain turns:',
      lineagePlainTurns.length
    );

    // 3b. A PDF document attachment reaches the model as a file part.
    const TINY_PDF = 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK';
    const sendPdf = await fetch(`${base}/message/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'Summarize this document.',
        provider: 'local',
        model: 'test-doc',
        attachments: [{ type: 'file', mediaType: 'application/pdf', dataUrl: TINY_PDF, name: 'notes.pdf' }]
      })
    });
    const seenPdf = mock.lastBody();
    const pdfTurn = (seenPdf?.messages ?? [])
      .filter((m: any) => Array.isArray(m.content))
      .find((m: any) => m.content.some((p: any) => p.type === 'file'));
    const filePart = pdfTurn?.content?.find((p: any) => p.type === 'file');
    console.log(
      'pdf send status:',
      sendPdf.status,
      '| file part filename:',
      filePart?.file?.filename,
      '| data matches:',
      filePart?.file?.file_data === TINY_PDF
    );

    // 3c. Document capability metadata is advertised.
    console.log('local documentModels:', JSON.stringify(local?.documentModels));

    // 4. Validation: too many attachments, and a non-image attachment.
    const tooMany = await fetch(`${base}/message/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'x',
        attachments: [attachment, attachment, attachment, attachment, attachment]
      })
    });
    const badType = await fetch(`${base}/message/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'x',
        attachments: [{ type: 'image', mediaType: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA' }]
      })
    });
    const badFile = await fetch(`${base}/message/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: session.id,
        content: 'x',
        attachments: [{ type: 'file', mediaType: 'text/plain', dataUrl: 'data:text/plain;base64,AAAA' }]
      })
    });
    console.log('5 attachments status (expect 400):', tooMany.status);
    console.log('non-image attachment status (expect 400):', badType.status);
    console.log('non-pdf file status (expect 400):', badFile.status);

    // Tidy up the test conversation.
    await fetch(`${base}/messages/${send1Body.userMessage.id}`, { method: 'DELETE' });

    const ok =
      Array.isArray(local?.visionModels) &&
      local.visionModels.includes('test-vision') &&
      send1.status === 201 &&
      imageTurn?.content?.length === 2 && // text part + image part
      imagePart?.image_url?.url === TINY_PNG &&
      Array.isArray(send1Body.userMessage?.attachments) &&
      send2.status === 201 &&
      lineageImageTurns.length === 1 && // the original image turn, preserved in context
      lineagePlainTurns.length >= 3 && // system + assistant + new user turn
      tooMany.status === 400 &&
      badType.status === 400 &&
      badFile.status === 400 &&
      sendPdf.status === 201 &&
      filePart?.file?.filename === 'notes.pdf' &&
      filePart?.file?.file_data === TINY_PDF &&
      Array.isArray(local?.documentModels) &&
      local.documentModels.includes('test-doc');

    cleanup();
    if (!ok) {
      console.error('FAILED: multimodal pipeline did not behave as expected.');
      process.exit(1);
    }
    console.log('PASSED: vision metadata, image delivery, lineage image context, and validation all work.');
  } catch (e) {
    cleanup();
    console.error(e);
    process.exit(1);
  }
}

main();
