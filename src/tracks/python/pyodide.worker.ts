/**
 * The Python runtime, off the main thread.
 *
 * Pyodide is a full CPython: a runaway `while True:` would freeze the whole IDE
 * if it ran on the UI thread. So the interpreter lives here, in a dedicated
 * worker, and the page only ever exchanges messages:
 *
 *   page → worker   { type: 'run', requestId, code, files, entry, dir, env }
 *   worker → page   { type: 'progress', stage, percent }
 *   worker → page   { type: 'delta', requestId, text, cumulative, at }  ← while streaming
 *   worker → page   { type: 'done', requestId, ok, stdout, stderr, error, ms, phase, loadMs, trace }
 *
 * Every page-bound string passes through `redactText` first: the API key of the
 * run that is starting may not reach the main thread, whatever the learner's
 * program printed or whatever the provider echoed back. Stream deltas carry the
 * *cumulative* masked text, because a key can be split across two SSE pieces and
 * only becomes visible once they are joined.
 *
 * Every run gets a fresh namespace and its own directory inside Pyodide's
 * virtual filesystem — and both are released again when the run ends
 * (`runtime-core.ts`), so a lesson run a hundred times leaves neither
 * directories nor proxies behind. The module table is reset before each run as
 * well (`module-cache.ts`), because an edited module would otherwise stay
 * cached for the rest of the lesson.
 *
 * This file is bundled as a classic worker (Vite builds it as an IIFE), which is
 * what lets it use `importScripts` for the Pyodide CDN build.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeProgram, runDirectory, type PyodideLike } from './runtime-core';
import { StreamRedactor, redactRunText, redactTrace, sanitizeTrace, type TraceEvent } from './trace';

const CDN = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';

const scope = self as any;

let runtime: any = null;
let loading: Promise<any> | null = null;

const post = (message: any) => scope.postMessage(message);

function loadRuntime(): Promise<any> {
  if (runtime) return Promise.resolve(runtime);
  if (loading) return loading;
  loading = (async () => {
    post({ type: 'progress', stage: 'script', percent: 12 });
    scope.importScripts(`${CDN}pyodide.js`);
    const loader = scope.loadPyodide;
    if (!loader) throw new Error('pyodide-loader-missing');
    post({ type: 'progress', stage: 'runtime', percent: 45 });
    const py = await loader({ indexURL: CDN });
    post({ type: 'progress', stage: 'runtime', percent: 92 });
    runtime = py;
    post({ type: 'progress', stage: 'ready', percent: 100 });
    return py;
  })().catch((error: unknown) => {
    // A failed download must be retryable: drop the half-built state, and let the
    // page terminate this worker and ask a fresh one next time.
    loading = null;
    runtime = null;
    throw error;
  });
  return loading;
}

scope.onmessage = async (event: any) => {
  const data = event?.data;
  if (!data || data.type !== 'run') return;
  const { requestId, code, files, entry, dir, env } = data as {
    requestId: number;
    code: string;
    files: Record<string, string>;
    entry: string;
    dir: string;
    env?: Record<string, string>;
  };
  const secret = typeof env?.LLM_API_KEY === 'string' ? env.LLM_API_KEY : '';
  const started = Date.now();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stream = new StreamRedactor(secret);
  let trace: TraceEvent[] = [];
  let ok = false;
  let error: string | undefined;
  let phase: 'load' | 'run' = 'load';
  let loadMs = 0;
  let py: any = null;
  try {
    py = await loadRuntime();
    loadMs = Date.now() - started;
    phase = 'run';
    await executeProgram(py as PyodideLike, {
      code,
      files,
      entry,
      // The page names the directory; a worker restarted by Stop gets a new one.
      dir: dir || runDirectory(requestId),
      onStdout: (text: string) => stdout.push(text),
      onStderr: (text: string) => stderr.push(text),
      env: env && typeof env === 'object' ? env : undefined,
      onTrace: (events) => {
        trace = events;
      },
      onDelta: (data) => {
        const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
        const text = typeof record.content === 'string' ? record.content : '';
        if (!text) return;
        // A provider may echo the key in pieces; only the cumulative text shows
        // whether two SSE deltas together spell it, so the page replaces its
        // buffer with this masked whole instead of appending a masked piece.
        post({ type: 'delta', requestId, text: stream.push(text), cumulative: true, at: Date.now() });
      },
    });
    ok = true;
  } catch (thrown: any) {
    if (phase === 'load') loadMs = Date.now() - started;
    error = String(thrown?.message ?? thrown).replace(/\s+at .*$/s, '').trim();
  }
  const safe = redactRunText(
    {
      stdout: stdout.join('\n').replace(/\n$/, ''),
      stderr: stderr.join('\n').replace(/\n$/, ''),
      error,
    },
    secret,
  );
  post({
    type: 'done',
    requestId,
    ok,
    ...safe,
    phase,
    ms: Date.now() - started,
    loadMs,
    trace: redactTrace(sanitizeTrace(trace), secret),
  });
};
