/**
 * CPython in the browser through Pyodide, fetched from the jsDelivr CDN the
 * first time the Python track needs it.
 *
 * The interpreter runs in a worker (see `pyodide.worker.ts`), so the page stays
 * responsive even while a program loops forever; this module is the only thing
 * the UI talks to. It owns five things:
 *
 *  1. **One run at a time.** A second request while a program is running is
 *     refused instead of interleaving two programs' output.
 *  2. **Request ids.** Results carry the id they were asked with; a result whose
 *     id is no longer current (the learner restarted the lesson, switched away,
 *     or the run was stopped) is dropped.
 *  3. **A way out.** `cancelPython()` terminates the worker — the only reliable
 *     way to stop a runaway loop — and the next run starts a fresh one.
 *  4. **Two separate limits.** Fetching ~10 MB of runtime and running the
 *     learner's code are different waits with different fixes: a slow first load
 *     is a connection problem (30 s), a program that never ends is a program
 *     problem (20 s, or a lesson's own longer limit). Each is reported as what
 *     it is.
 *  5. **A retryable loader.** A failed CDN download leaves no half-initialised
 *     state behind, so pressing Run again really does try again.
 */
import { sanitizeTrace, type TraceEvent } from './trace';
export type PythonStage = 'idle' | 'script' | 'runtime' | 'ready' | 'error';

export interface PythonProgress {
  stage: PythonStage;
  percent: number;
}

export interface PythonRun {
  /** true only when the program finished without raising. */
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  /** Time spent running the program (not counting a runtime download). */
  ms: number;
  /** 'cancelled' when the learner pressed Stop, 'timeout' when a limit expired. */
  stoppedBy?: 'user' | 'timeout';
  /** Which part of the run the error or timeout belongs to. */
  phase?: 'load' | 'run';
  /** How long the runtime took to come up this run (0 when it was already up). */
  loadMs?: number;
  /** Request/response audit trail, when the lesson's program wrote one. */
  trace?: TraceEvent[];
}

export interface PythonRunOptions {
  /** Limit for the learner's program. */
  timeoutMs?: number;
  /** Limit for fetching and initialising Pyodide. */
  loadTimeoutMs?: number;
  /** Lesson settings for this run; the worker clears them when it ends. */
  env?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_LOAD_TIMEOUT_MS = 30_000;

/** The limits the UI quotes back to the learner, in one place. */
export const PYTHON_RUN_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
export const PYTHON_LOAD_TIMEOUT_MS = DEFAULT_LOAD_TIMEOUT_MS;

export interface PythonWorker {
  postMessage: (message: unknown) => void;
  terminate: () => void;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
}

const makeWorker = (): PythonWorker => {
  // Vite bundles this as a classic worker for the production build.
  return new Worker(new URL('./pyodide.worker.ts', import.meta.url)) as unknown as PythonWorker;
};

let workerFactory: () => PythonWorker = makeWorker;
let worker: PythonWorker | null = null;

interface PendingRun {
  id: number;
  resolve: (run: PythonRun) => void;
  timer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  /** Which limit is currently armed. */
  phase: 'load' | 'run';
  timeoutMs: number;
  loadTimeoutMs: number;
}

let current: PendingRun | null = null;
let sequence = 0;
let progress: PythonProgress = { stage: 'idle', percent: 0 };

export const pythonStatus = (): PythonProgress => progress;

export const isPythonBusy = (): boolean => current !== null;

/** Test seam: lets the unit suite drive the protocol without a browser. */
export function __setPythonWorkerFactory(factory: (() => PythonWorker) | null): void {
  disposeWorker();
  workerFactory = factory ?? makeWorker;
  progress = { stage: 'idle', percent: 0 };
}

function setProgress(stage: PythonStage, percent: number) {
  progress = { stage, percent };
}

function disposeWorker() {
  if (worker) {
    try {
      worker.terminate();
    } catch {
      /* already gone */
    }
  }
  worker = null;
  // A worker that is gone holds no runtime: the next one loads Pyodide again, so
  // its wait is a load wait, not a program wait. An explicit error stays visible.
  if (progress.stage === 'ready') progress = { stage: 'idle', percent: 0 };
}

function settle(run: PythonRun) {
  const pending = current;
  if (!pending) return;
  current = null;
  if (pending.timer) clearTimeout(pending.timer);
  pending.resolve(run);
}

/** (Re)arms the clock for the phase the run is in now. */
function armPhase(pending: PendingRun, phase: 'load' | 'run') {
  if (pending.timer) clearTimeout(pending.timer);
  pending.phase = phase;
  const limit = phase === 'load' ? pending.loadTimeoutMs : pending.timeoutMs;
  pending.timer = setTimeout(() => onLimitReached(pending, phase), limit);
}

function onLimitReached(pending: PendingRun, phase: 'load' | 'run') {
  if (!current || current.id !== pending.id) return;
  const ms = Date.now() - pending.startedAt;
  // Only the worker can be killed safely; the page never blocks on the loop.
  disposeWorker();
  if (phase === 'load') {
    // The runtime never came up: that is a connection problem, not a bug in the
    // learner's program, so the next attempt starts from a cold worker.
    setProgress('error', 0);
    settle({ ok: false, stdout: '', stderr: '', error: 'load-timeout', ms, stoppedBy: 'timeout', phase: 'load' });
    return;
  }
  settle({ ok: false, stdout: '', stderr: '', error: 'timeout', ms, stoppedBy: 'timeout', phase: 'run' });
}

function onWorkerMessage(event: unknown) {
  const data = (event as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'progress') {
    const stage = data.stage as PythonStage;
    setProgress(stage, Number(data.percent ?? 0));
    // The runtime is up, so from here the clock belongs to the program.
    if (stage === 'ready' && current && current.phase === 'load') armPhase(current, 'run');
    return;
  }
  if (data.type !== 'done') return;
  const requestId = Number(data.requestId);
  // A result for a run that was stopped or superseded must not touch the UI.
  if (!current || current.id !== requestId) return;
  const ok = data.ok === true;
  const phase = data.phase === 'load' ? 'load' : 'run';
  const loadMs = Number(data.loadMs ?? 0);
  const total = Number(data.ms ?? 0);
  if (ok) {
    // A finished program proves the runtime is up, whatever progress said.
    setProgress('ready', 100);
  } else if (phase === 'load') {
    // The runtime itself failed to load (not the learner's program): report it
    // and make the next try start from a fresh worker.
    setProgress('error', 0);
    disposeWorker();
  }
  settle({
    ok,
    stdout: String(data.stdout ?? ''),
    stderr: String(data.stderr ?? ''),
    error: ok ? undefined : String(data.error ?? 'error'),
    ms: Math.max(0, total - loadMs),
    phase,
    loadMs,
    trace: sanitizeTrace(data.trace),
  });
}

function onWorkerError(event: unknown) {
  const message = (event as { message?: string })?.message ?? 'python-worker-failed';
  const phase = current?.phase ?? 'run';
  if (progress.stage !== 'ready') setProgress('error', 0);
  disposeWorker();
  settle({ ok: false, stdout: '', stderr: '', error: message, ms: 0, phase });
}

function ensureWorker(): PythonWorker {
  if (worker) return worker;
  const created = workerFactory();
  created.addEventListener('message', onWorkerMessage);
  created.addEventListener('error', onWorkerError);
  worker = created;
  return created;
}

/**
 * Runs one program. Resolves with `ok: false` rather than throwing, because a
 * failed lesson run is a normal thing to show in the terminal.
 */
export function runPython(
  code: string,
  files: Record<string, string> = {},
  entry = 'main.py',
  options: PythonRunOptions = {},
): Promise<PythonRun> {
  if (current) {
    return Promise.resolve({
      ok: false,
      stdout: '',
      stderr: '',
      error: 'busy',
      ms: 0,
    });
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const id = ++sequence;
  return new Promise<PythonRun>((resolve) => {
    let target: PythonWorker;
    const hadWorker = worker !== null;
    try {
      target = ensureWorker();
    } catch {
      setProgress('error', 0);
      resolve({ ok: false, stdout: '', stderr: '', error: 'python-worker-unavailable', ms: 0 });
      return;
    }
    // A worker that already serves a ready runtime only has to run the program;
    // a cold one has to download it first, which gets its own limit.
    const warm = hadWorker && progress.stage === 'ready';
    if (!warm && (progress.stage === 'idle' || progress.stage === 'error')) setProgress('script', 4);
    const pending: PendingRun = {
      id,
      resolve,
      timer: null,
      startedAt: Date.now(),
      phase: warm ? 'run' : 'load',
      timeoutMs,
      loadTimeoutMs,
    };
    current = pending;
    armPhase(pending, warm ? 'run' : 'load');
    try {
      target.postMessage({
        type: 'run',
        requestId: id,
        code,
        files,
        entry,
        dir: `/tmp/codeplayground/run-${id}`,
        env: options.env,
      });
    } catch (error) {
      disposeWorker();
      settle({
        ok: false,
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error.message : String(error),
        ms: 0,
      });
    }
  });
}

/** Stops the running program (and its worker). Returns false when idle. */
export function cancelPython(): boolean {
  if (!current) return false;
  const startedAt = current.startedAt;
  const phase = current.phase;
  disposeWorker();
  settle({
    ok: false,
    stdout: '',
    stderr: '',
    error: 'cancelled',
    ms: Date.now() - startedAt,
    stoppedBy: 'user',
    phase,
  });
  return true;
}

/** Shuts the worker down — called when the lesson leaves the screen. */
export function disposePython(): void {
  if (current) {
    const startedAt = current.startedAt;
    const phase = current.phase;
    disposeWorker();
    settle({ ok: false, stdout: '', stderr: '', error: 'cancelled', ms: Date.now() - startedAt, stoppedBy: 'user', phase });
  }
  disposeWorker();
}

/** Pyodide's version string, once loaded — the status bar shows it. */
export function pythonVersion(): string | null {
  if (progress.stage !== 'ready') return null;
  return `CPython 3.13 · Pyodide`;
}
