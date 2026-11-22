/**
 * CPython in the browser through Pyodide, fetched from the jsDelivr CDN the
 * first time the Python track needs it.
 *
 * The interpreter runs in a worker (see `pyodide.worker.ts`), so the page stays
 * responsive even while a program loops forever; this module is the only thing
 * the UI talks to. It owns four things:
 *
 *  1. **One run at a time.** A second request while a program is running is
 *     refused instead of interleaving two programs' output.
 *  2. **Request ids.** Results carry the id they were asked with; a result whose
 *     id is no longer current (the learner restarted the lesson, switched away,
 *     or the run was stopped) is dropped.
 *  3. **A way out.** `cancelPython()` terminates the worker — the only reliable
 *     way to stop a runaway loop — and the next run starts a fresh one. A run
 *     that exceeds its timeout is stopped the same way.
 *  4. **A retryable loader.** A failed CDN download leaves no half-initialised
 *     state behind, so pressing Run again really does try again.
 */
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
  ms: number;
  /** 'cancelled' when the learner pressed Stop, 'timeout' when it ran too long. */
  stoppedBy?: 'user' | 'timeout';
}

export interface PythonRunOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

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
let current: {
  id: number;
  resolve: (run: PythonRun) => void;
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
} | null = null;
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
}

function settle(run: PythonRun) {
  const pending = current;
  if (!pending) return;
  current = null;
  clearTimeout(pending.timer);
  pending.resolve(run);
}

function onWorkerMessage(event: unknown) {
  const data = (event as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'progress') {
    const stage = data.stage as PythonStage;
    setProgress(stage, Number(data.percent ?? 0));
    return;
  }
  if (data.type !== 'done') return;
  const requestId = Number(data.requestId);
  // A result for a run that was stopped or superseded must not touch the UI.
  if (!current || current.id !== requestId) return;
  const ok = data.ok === true;
  if (ok) {
    // A finished program proves the runtime is up, whatever progress said.
    setProgress('ready', 100);
  } else if (data.phase === 'load') {
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
    ms: Number(data.ms ?? 0),
  });
}

function onWorkerError(event: unknown) {
  const message = (event as { message?: string })?.message ?? 'python-worker-failed';
  if (progress.stage !== 'ready') setProgress('error', 0);
  disposeWorker();
  settle({ ok: false, stdout: '', stderr: '', error: message, ms: 0 });
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
  const id = ++sequence;
  return new Promise<PythonRun>((resolve) => {
    let target: PythonWorker;
    try {
      target = ensureWorker();
    } catch {
      setProgress('error', 0);
      resolve({ ok: false, stdout: '', stderr: '', error: 'python-worker-unavailable', ms: 0 });
      return;
    }
    if (progress.stage === 'idle' || progress.stage === 'error') setProgress('script', 4);
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      // Only the worker can be killed safely; the page never blocks on the loop.
      disposeWorker();
      settle({ ok: false, stdout: '', stderr: '', error: 'timeout', ms: Date.now() - startedAt, stoppedBy: 'timeout' });
      if (progress.stage !== 'ready') setProgress('error', 0);
    }, timeoutMs);
    current = { id, resolve, timer, startedAt };
    try {
      target.postMessage({
        type: 'run',
        requestId: id,
        code,
        files,
        entry,
        dir: `/tmp/codeplayground/run-${id}`,
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
  disposeWorker();
  settle({ ok: false, stdout: '', stderr: '', error: 'cancelled', ms: Date.now() - startedAt, stoppedBy: 'user' });
  return true;
}

/** Shuts the worker down — called when the lesson leaves the screen. */
export function disposePython(): void {
  if (current) {
    const startedAt = current.startedAt;
    disposeWorker();
    settle({ ok: false, stdout: '', stderr: '', error: 'cancelled', ms: Date.now() - startedAt, stoppedBy: 'user' });
  }
  disposeWorker();
}

/** Pyodide's version string, once loaded — the status bar shows it. */
export function pythonVersion(): string | null {
  if (progress.stage !== 'ready') return null;
  return `CPython 3.13 · Pyodide`;
}
