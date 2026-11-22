/**
 * The Python runtime's protocol, driven without a browser (WO-03):
 * request ids, one run at a time, stop, timeout and the retryable loader.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setPythonWorkerFactory,
  cancelPython,
  disposePython,
  isPythonBusy,
  pythonStatus,
  runPython,
  type PythonWorker,
} from '../src/tracks/python/runner';

type Handler = (event: unknown) => void;

class FakeWorker implements PythonWorker {
  sent: Record<string, unknown>[] = [];
  terminated = 0;
  private handlers = new Map<string, Handler[]>();

  postMessage(message: unknown) {
    this.sent.push(message as Record<string, unknown>);
  }

  terminate() {
    this.terminated += 1;
  }

  addEventListener(type: string, listener: Handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), listener]);
  }

  emit(type: string, event: unknown) {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }

  send(data: unknown) {
    this.emit('message', { data });
  }

  /** The request id of the last run this worker was asked to perform. */
  get lastRequestId(): number {
    return Number(this.sent[this.sent.length - 1]?.requestId ?? 0);
  }
}

const workers: FakeWorker[] = [];
const useFakeWorkers = () => {
  const created: FakeWorker[] = [];
  __setPythonWorkerFactory(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    created.push(worker);
    return worker;
  });
  return created;
};

beforeEach(() => {
  disposePython();
  workers.length = 0;
  vi.useRealTimers();
});

describe('Python runtime protocol', () => {
  it('sends one request per run and routes stdout, stderr and errors by id', async () => {
    const created = useFakeWorkers();
    const pending = runPython('print(1)', { 'main.py': 'print(1)' }, 'main.py');

    const worker = created[0];
    expect(worker.sent).toHaveLength(1);
    expect(worker.sent[0]).toMatchObject({ type: 'run', requestId: 1, entry: 'main.py' });
    expect(isPythonBusy()).toBe(true);

    worker.send({ type: 'progress', stage: 'script', percent: 12 });
    expect(pythonStatus().stage).toBe('script');

    worker.send({
      type: 'done',
      requestId: 1,
      ok: true,
      stdout: '1',
      stderr: 'warn',
      ms: 12,
    });

    await expect(pending).resolves.toMatchObject({ ok: true, stdout: '1', stderr: 'warn', ms: 12 });
    expect(isPythonBusy()).toBe(false);
    expect(pythonStatus().stage).toBe('ready');
  });

  it('refuses a second program while one is running instead of interleaving', async () => {
    const created = useFakeWorkers();
    const first = runPython('a', {}, 'main.py');
    const second = await runPython('b', {}, 'main.py');

    expect(second).toMatchObject({ ok: false, error: 'busy' });
    expect(created[0].sent).toHaveLength(1); // nothing was sent for the second call

    created[0].send({ type: 'progress', stage: 'ready', percent: 100 });
    created[0].send({ type: 'done', requestId: created[0].lastRequestId, ok: true, stdout: '', stderr: '', ms: 1 });
    expect((await first).ok).toBe(true);
  });

  it('stops a runaway program by terminating its worker', async () => {
    const created = useFakeWorkers();
    created[0];
    const pending = runPython('while True: pass', {}, 'main.py');

    expect(cancelPython()).toBe(true);
    await expect(pending).resolves.toMatchObject({ ok: false, stoppedBy: 'user' });
    expect(isPythonBusy()).toBe(false);

    // the worker is gone, so the next run gets a fresh one (a clean runtime)
    const next = runPython('print(2)', {}, 'main.py');
    expect(workers).toHaveLength(2);
    const fresh = workers[1];
    fresh.send({ type: 'progress', stage: 'ready', percent: 100 });
    fresh.send({ type: 'done', requestId: fresh.lastRequestId, ok: true, stdout: '2', stderr: '', ms: 3 });
    await expect(next).resolves.toMatchObject({ ok: true, stdout: '2' });
  });

  it('kills a program that exceeds its own limit', async () => {
    const created = useFakeWorkers();
    vi.useFakeTimers();
    const pending = runPython('while True: pass', {}, 'main.py', { timeoutMs: 500 });
    // The runtime is up, so only the program's clock is running.
    created[0].send({ type: 'progress', stage: 'ready', percent: 100 });
    await vi.advanceTimersByTimeAsync(501);
    await expect(pending).resolves.toMatchObject({ ok: false, stoppedBy: 'timeout', phase: 'run' });
    expect(created[0].terminated).toBeGreaterThan(0);
    expect(isPythonBusy()).toBe(false);
  });

  it('gives a cold runtime its own longer limit than the program', async () => {
    const created = useFakeWorkers();
    vi.useFakeTimers();
    const pending = runPython('print(1)', {}, 'main.py', { timeoutMs: 500, loadTimeoutMs: 5_000 });

    // Loading for longer than the program limit must not be reported as the
    // program running too long.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(isPythonBusy()).toBe(true);

    created[0].send({ type: 'progress', stage: 'ready', percent: 100 });
    await vi.advanceTimersByTimeAsync(501);
    await expect(pending).resolves.toMatchObject({ ok: false, error: 'timeout', phase: 'run' });
  });

  it('reports a runtime that never loads as a load timeout, not a program error', async () => {
    const created = useFakeWorkers();
    vi.useFakeTimers();
    const pending = runPython('print(1)', {}, 'main.py', { timeoutMs: 20_000, loadTimeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: 'load-timeout',
      stoppedBy: 'timeout',
      phase: 'load',
    });
    expect(created[0].terminated).toBeGreaterThan(0);
    // A failed load is a runtime problem: the output card shows the offline note
    // and the next attempt starts from a cold worker.
    expect(pythonStatus().stage).toBe('error');
    const retry = runPython('print(1)', {}, 'main.py');
    expect(workers).toHaveLength(2);
    expect(isPythonBusy()).toBe(true);
    workers[1].send({ type: 'progress', stage: 'ready', percent: 100 });
    workers[1].send({ type: 'done', requestId: workers[1].lastRequestId, ok: true, stdout: '1', stderr: '', ms: 9, loadMs: 4 });
    await expect(retry).resolves.toMatchObject({ ok: true, stdout: '1', ms: 5, loadMs: 4 });
  });

  it('separates the runtime download time from the program time', async () => {
    const created = useFakeWorkers();
    const pending = runPython('print(1)', {}, 'main.py');
    created[0].send({ type: 'progress', stage: 'ready', percent: 100 });
    created[0].send({
      type: 'done',
      requestId: created[0].lastRequestId,
      ok: true,
      stdout: '1',
      stderr: '',
      ms: 5_030,
      loadMs: 5_000,
    });
    await expect(pending).resolves.toMatchObject({ ok: true, ms: 30, loadMs: 5_000 });
  });

  it('drops a result that belongs to a run the learner already left', async () => {
    const created = useFakeWorkers();
    const first = runPython('slow', {}, 'main.py');
    const firstId = created[0].lastRequestId;
    cancelPython();
    await expect(first).resolves.toMatchObject({ stoppedBy: 'user' });

    const second = runPython('fast', {}, 'main.py', { timeoutMs: 5_000 });
    const worker = workers[workers.length - 1];
    // the stopped run's result arrives late: it must not resolve the new run
    worker.send({ type: 'done', requestId: firstId, ok: true, stdout: 'stale', stderr: '', ms: 9 });
    expect(isPythonBusy()).toBe(true);

    worker.send({ type: 'done', requestId: worker.lastRequestId, ok: true, stdout: 'fresh', stderr: '', ms: 2 });
    await expect(second).resolves.toMatchObject({ ok: true, stdout: 'fresh' });
  });

  it('reports a failed CDN load and retries with a fresh worker', async () => {
    const created = useFakeWorkers();
    const failed = runPython('print(1)', {}, 'main.py');
    created[0].send({
      type: 'done',
      requestId: created[0].lastRequestId,
      ok: false,
      stdout: '',
      stderr: '',
      error: 'Failed to load pyodide.js',
      phase: 'load',
      ms: 4,
    });
    await expect(failed).resolves.toMatchObject({ ok: false });
    expect(pythonStatus().stage).toBe('error');
    expect(isPythonBusy()).toBe(false);

    const retry = runPython('print(1)', {}, 'main.py');
    expect(workers).toHaveLength(2);
    const worker = workers[1];
    worker.send({ type: 'progress', stage: 'runtime', percent: 45 });
    worker.send({ type: 'progress', stage: 'ready', percent: 100 });
    worker.send({ type: 'done', requestId: worker.lastRequestId, ok: true, stdout: 'ok', stderr: '', ms: 5 });
    await expect(retry).resolves.toMatchObject({ ok: true, stdout: 'ok' });
    expect(pythonStatus().stage).toBe('ready');
  });

  it('keeps a program error separate from a successful run', async () => {
    const created = useFakeWorkers();
    const pending = runPython('raise ValueError("boom")', {}, 'main.py');
    created[0].send({ type: 'progress', stage: 'ready', percent: 100 });
    created[0].send({
      type: 'done',
      requestId: created[0].lastRequestId,
      ok: false,
      stdout: 'partial',
      stderr: '',
      error: 'ValueError: boom',
      ms: 3,
    });
    const run = await pending;
    expect(run.ok).toBe(false);
    expect(run.error).toContain('ValueError');
    // the runtime itself is fine, so no reload is needed
    expect(pythonStatus().stage).not.toBe('error');
  });
});
