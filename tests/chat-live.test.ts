/**
 * Live Mode, exercised for real: the lesson's own `llm_client.py` talks HTTP to
 * a local OpenAI-compatible server. No paid key, no network — every scenario
 * (status codes, malformed bodies, split SSE, truncated Korean, abnormal close)
 * is served from this process.
 *
 * The browser transport is Pyodide's `fetch`; CPython uses urllib behind the
 * same client code, which is why the parsing and error paths can be checked
 * here. CORS itself is a browser rule and is covered by the Playwright suite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lessonById } from '../src/lessons';
import type { Lesson } from '../src/lessons/types';

const lesson = lessonById('chat-completion') as Lesson;
const KEY = 'sk-live-SECRET-987654';

const hasPython = (() => {
  try {
    execFileSync('python3', ['-c', 'print(1)'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

const completion = (content: string, extra: Record<string, unknown> = {}) => ({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  model: 'test-model',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  ...extra,
});

const sseLines = (content: string, options: { done?: boolean; finish?: string | null; usage?: boolean } = {}) => {
  const chunks = content.split(' ');
  const lines = chunks.map(
    (piece, index) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `${piece}${index < chunks.length - 1 ? ' ' : ''}` } }] })}`,
  );
  if (options.finish !== null) {
    lines.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: options.finish ?? 'stop' }] })}`);
  }
  if (options.usage !== false) {
    lines.push(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })}`);
  }
  if (options.done !== false) lines.push('data: [DONE]');
  return lines;
};

const sse = (content: string, options: { done?: boolean; finish?: string | null; usage?: boolean } = {}) => ({
  chunks: sseLines(content, options),
  body: sseLines(content, options).join('\r\n\r\n') + '\r\n\r\n',
});

let server: Server;
let base = '';

/** Routes are chosen by the first path segment, so each scenario has its own URL. */
const route = (path: string): string => path.split('/')[1] ?? '';

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const name = route(request.url ?? '/');
    const allowCors = name !== 'cors-denied';
    if (allowCors) {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', '*');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(allowCors ? 204 : 403).end();
      return;
    }
    const send = (status: number, body: unknown, type = 'application/json') => {
      response.writeHead(status, { 'Content-Type': type }).end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const status = /^status-(\d+)$/.exec(name);
    if (status) {
      send(Number(status[1]), { error: { message: `denied for key ${KEY}` } });
      return;
    }
    switch (name) {
      case 'ok':
        send(200, completion('안녕하세요! 실제 HTTP 응답입니다.'));
        return;
      case 'no-usage':
        send(200, completion('usage 없는 응답', { usage: undefined }));
        return;
      case 'no-choices':
        send(200, { id: 'x', object: 'chat.completion' });
        return;
      case 'invalid-json':
        send(200, 'not json at all', 'text/plain');
        return;
      case 'echo-key':
        send(200, completion(`your key is ${KEY}`));
        return;
      case 'echo-key-error':
        response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: `bad key ${KEY}` } }));
        return;
      case 'stream': {
        const { body } = sse('안녕하세요 스트림입니다 반갑습니다');
        const bytes = Buffer.from(body, 'utf8');
        // Split the Korean text mid-codepoint and mid-line, drip the bytes.
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        let index = 0;
        const step = () => {
          if (index >= bytes.length) {
            response.end();
            return;
          }
          const size = index === 0 ? 7 : 5;
          response.write(bytes.subarray(index, index + size));
          index += size;
          setTimeout(step, 1);
        };
        step();
        return;
      }
      case 'stream-no-done': {
        const body = sseLines('끊긴 스트림', { done: false, finish: null }).join('\r\n\r\n') + '\r\n\r\n';
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end(body);
        return;
      }
      case 'cors-denied':
        send(200, completion('브라우저라면 CORS 에 막힙니다'));
        return;
      default:
        send(404, { error: { message: 'unknown scenario' } });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server did not bind');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Outcome {
  stdout: string;
  trace: string;
}

/** Runs a small program against one mock scenario and returns output + trace. */
const live = async (scenario: string, body: string, extraEnv: Record<string, string> = {}): Promise<Outcome> => {
  const dir = mkdtempSync(join(tmpdir(), 'pk13-live-'));
  try {
    writeFileSync(join(dir, 'llm_client.py'), `${lesson.files['llm_client.py']}\n`, 'utf8');
    const program = ['import asyncio', 'import json', 'async def main():', ...body.trim().split('\n').map((line) => `    ${line}`), '', 'asyncio.run(main())'].join('\n');
    writeFileSync(join(dir, 'main.py'), `${program}\n`, 'utf8');
    const tracePath = join(dir, '.trace.jsonl');
    // Async, not execFileSync: the mock server runs in this same process.
    const { stdout } = await promisify(execFile)('python3', ['main.py'], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        no_proxy: '*',
        NO_PROXY: '*',
        LLM_MODE: 'live',
        LLM_BASE_URL: `${base}/${scenario}`,
        LLM_API_KEY: KEY,
        LLM_MODEL: 'test-model',
        CP_TRACE_PATH: tracePath,
        ...extraEnv,
      },
    });
    let trace = '';
    try {
      trace = readFileSync(tracePath, 'utf8');
    } catch {
      trace = '';
    }
    return { stdout, trace };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const chatCall = `
from llm_client import chat
try:
    response = await chat([{"role": "user", "content": "hi"}])
    print("OK", response["choices"][0]["message"]["content"])
    print("TOKENS", response.get("usage", {}).get("total_tokens", "N/A"))
except Exception as error:
    print("ERR", type(error).__name__, str(error))
`;

const streamCall = `
from llm_client import stream_chat
try:
    response = await stream_chat([{"role": "user", "content": "hi"}])
    print("OK", response["choices"][0]["message"]["content"])
    print("CHUNKS", len(response["chunks"]))
except Exception as error:
    print("ERR", type(error).__name__, str(error))
`;

describe.skipIf(!hasPython)('Live Mode against a local OpenAI-compatible server', () => {
  it('reads a 200 response, its usage and never records the raw key', async () => {
    const { stdout, trace } = await live('ok', chatCall);
    expect(stdout).toContain('OK 안녕하세요! 실제 HTTP 응답입니다.');
    expect(stdout).toContain('TOKENS 7');
    expect(trace).toContain('"kind": "request"');
    expect(trace).not.toContain(KEY);
    expect(trace).toContain('Bearer sk-l••••7654');
    const kinds = trace.trim().split('\n').map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(kinds).toEqual(['preview', 'request', 'response', 'usage']);
  });

  it('turns 401, 403, 404, 429, 500 and 503 into readable, masked errors', async () => {
    for (const status of [401, 403, 404, 429, 500, 503]) {
      const { stdout, trace } = await live(`status-${status}`, chatCall);
      expect(stdout).toContain(`HTTP ${status}`);
      // The server echoes the key in its error message; it must not leave the program.
      expect(stdout).not.toContain(KEY);
      expect(stdout).toContain('sk-l••••7654');
      expect(trace).not.toContain(KEY);
      expect(trace).toContain('"kind": "error"');
      expect(trace).toContain(`"status": ${status}`);
    }
  });

  it('masks a key that a successful response echoes back', async () => {
    const { stdout, trace } = await live('echo-key', chatCall);
    // The program prints the raw response; the worker masks stdout in the app.
    expect(stdout).toContain(KEY);
    expect(trace).not.toContain(KEY);
    expect(trace).toContain('sk-l••••7654');
  });

  it('masks a key echoed inside an error body', async () => {
    const { stdout, trace } = await live('echo-key-error', chatCall);
    expect(stdout).toContain('HTTP 500');
    expect(stdout).not.toContain(KEY);
    expect(trace).not.toContain(KEY);
  });

  it('rejects a non-JSON body instead of pretending it parsed', async () => {
    const { stdout, trace } = await live('invalid-json', chatCall);
    expect(stdout).toContain('JSON 이 아닌 응답');
    expect(trace).toContain('"kind": "error"');
  });

  it('rejects a response with no choices and reports missing usage as N/A', async () => {
    const noChoices = await live('no-choices', chatCall);
    expect(noChoices.stdout).toContain('choices 가 없습니다');

    const noUsage = await live('no-usage', chatCall);
    expect(noUsage.stdout).toContain('OK usage 없는 응답');
    expect(noUsage.stdout).toContain('TOKENS N/A');
    const kinds = noUsage.trace.trim().split('\n').map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(kinds).not.toContain('usage');
  });

  it('reassembles SSE split mid-line and mid-Hangul, with CRLF and usage', async () => {
    const { stdout, trace } = await live('stream', streamCall);
    expect(stdout).toContain('OK 안녕하세요 스트림입니다 반갑습니다');
    expect(stdout).toContain('CHUNKS 5');
    const kinds = trace.trim().split('\n').map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(kinds.filter((kind) => kind === 'chunk').length).toBe(5);
    expect(kinds).toContain('stream');
    expect(kinds).toContain('usage');
    expect(trace).toContain('"done": true');
    expect(trace).not.toContain(KEY);
  });

  it('does not count a stream that ends without [DONE] or finish_reason as success', async () => {
    const { stdout, trace } = await live('stream-no-done', streamCall);
    expect(stdout).toContain('ERR RuntimeError');
    expect(stdout).toContain('끊겼습니다');
    expect(trace).not.toContain('"done": true');
    const stream = trace
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind: string; data: { done?: boolean } })
      .find((event) => event.kind === 'stream');
    expect(stream).toBeUndefined();
  });

  it('sends the Authorization header only when a key is configured', async () => {
    const without = await live('ok', chatCall, { LLM_API_KEY: '' });
    expect(without.trace).not.toContain('Authorization');
    expect(without.stdout).toContain('OK');
  });
});
