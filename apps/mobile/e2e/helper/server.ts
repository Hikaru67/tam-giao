import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { HttpError } from '../../../../tests/e2e/src/lib/http.js';
import { loadHelperConfig } from './config.js';
import { MobileE2eScenario } from './scenario.js';
import { isHelperStep } from './steps.js';

const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

const config = loadHelperConfig(process.env);
const scenario = new MobileE2eScenario(config);

// Chuỗi promise làm mutex bảo đảm các bước POST /steps/:name luôn chạy tuần tự.
let stepQueue: Promise<void> = Promise.resolve();
function runSerialized<T>(task: () => Promise<T>): Promise<T> {
  const result = stepQueue.then(task, task);
  stepQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  req.resume();
  const pathname = (req.url ?? '/').split('?')[0] ?? '/';

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  const stepMatch = /^\/steps\/([^/]+)$/.exec(pathname);
  if (req.method === 'POST' && stepMatch !== null) {
    const stepName = decodeURIComponent(stepMatch[1] ?? '');
    if (!isHelperStep(stepName)) {
      sendJson(res, 404, { error: 'unknown step' });
      return;
    }

    const startedAt = performance.now();
    try {
      const output = await runSerialized(() => scenario.run(stepName));
      const ms = Math.round(performance.now() - startedAt);
      log(`[helper] ${stepName} ok (${ms} ms)`);
      sendJson(res, 200, output);
    } catch (error) {
      const ms = Math.round(performance.now() - startedAt);
      const message = error instanceof Error ? error.message : String(error);
      log(`[helper] ${stepName} FAIL (${ms} ms) — ${message}`);
      const payload: { error: string; problem?: unknown } = { error: message };
      if (error instanceof HttpError && typeof error.body === 'object' && error.body !== null) {
        payload.problem = error.body;
      }
      sendJson(res, 500, payload);
    }
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

const server = createServer((req, res) => {
  void handleRequest(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) sendJson(res, 500, { error: message });
  });
});

const shutdown = (): void => {
  server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(config.port, '127.0.0.1', () => {
  log(`[helper] listening on 127.0.0.1:${config.port}`);
});
