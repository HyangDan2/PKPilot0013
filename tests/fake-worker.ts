/**
 * A stand-in for the Pyodide worker, for tests that need the real `useSandbox`
 * hook but cannot download a runtime. The protocol is the same one
 * `pyodide.worker.ts` speaks.
 */
import { __setPythonWorkerFactory, type PythonWorker } from '../src/tracks/python/runner';

type Handler = (event: unknown) => void;

export class FakeWorker implements PythonWorker {
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

  get lastRequestId(): number {
    return Number(this.sent[this.sent.length - 1]?.requestId ?? 0);
  }

  /** Completes the last request with a clean run. */
  finish(stdout: string, extra: Record<string, unknown> = {}) {
    this.send({
      type: 'done',
      requestId: this.lastRequestId,
      ok: true,
      stdout,
      stderr: '',
      ms: 4,
      loadMs: 0,
      ...extra,
    });
  }
}

/** Routes the runner through fakes and returns every worker it created. */
export function installFakeWorkers(): FakeWorker[] {
  const created: FakeWorker[] = [];
  __setPythonWorkerFactory(() => {
    const worker = new FakeWorker();
    created.push(worker);
    return worker;
  });
  return created;
}
