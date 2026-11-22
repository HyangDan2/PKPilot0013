/**
 * The Python runtime, off the main thread.
 *
 * Pyodide is a full CPython: a runaway `while True:` would freeze the whole IDE
 * if it ran on the UI thread. So the interpreter lives here, in a dedicated
 * worker, and the page only ever exchanges messages:
 *
 *   page → worker   { type: 'run', requestId, code, files, entry, dir }
 *   worker → page   { type: 'progress', stage, percent }
 *   worker → page   { type: 'done', requestId, ok, stdout, stderr, error, ms, phase, loadMs }
 *
 * Every run gets a fresh namespace and its own directory inside Pyodide's
 * virtual filesystem, so one run cannot leak variables, files or output into
 * the next — and `main.py` can `import` the lesson's other files. The module
 * table is reset before each run as well (`module-cache.ts`), because an edited
 * module would otherwise stay cached for the rest of the lesson.
 *
 * This file is bundled as a classic worker (Vite builds it as an IIFE), which is
 * what lets it use `importScripts` for the Pyodide CDN build.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { PY_RUN_ROOT, moduleResetScript } from './module-cache';

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

/** Writes the editor's files into the interpreter's virtual filesystem. */
function writeTree(py: any, dir: string, files: Record<string, string>): void {
  py.FS.mkdirTree(dir);
  for (const [name, content] of Object.entries(files)) {
    const path = `${dir}/${name}`;
    const parent = path.slice(0, path.lastIndexOf('/'));
    if (parent && parent !== dir) py.FS.mkdirTree(parent);
    py.FS.writeFile(path, content);
  }
}

scope.onmessage = async (event: any) => {
  const data = event?.data;
  if (!data || data.type !== 'run') return;
  const { requestId, code, files, entry, dir } = data as {
    requestId: number;
    code: string;
    files: Record<string, string>;
    entry: string;
    dir: string;
  };
  const started = Date.now();
  const stdout: string[] = [];
  const stderr: string[] = [];
  let ok = false;
  let error: string | undefined;
  let phase: 'load' | 'run' = 'load';
  let loadMs = 0;
  try {
    const py = await loadRuntime();
    loadMs = Date.now() - started;
    phase = 'run';
    // A private namespace per run: the same name defined twice does not leak.
    const globals = py.globals.get('dict')();
    globals.set('__name__', '__main__');
    globals.set('__file__', entry);
    writeTree(py, dir, files);
    py.setStdout({ batched: (text: string) => stdout.push(text) });
    py.setStderr({ batched: (text: string) => stderr.push(text) });
    // The interpreter is shared between runs, so its module table is not:
    // drop the lesson's modules loaded by an earlier run, and the earlier run
    // directories, so an edited practice.py is really re-imported.
    py.runPython(moduleResetScript(files, PY_RUN_ROOT));
    // `import practice` finds the lesson files because the run directory is on
    // sys.path, and open('data.txt') resolves there too.
    py.runPython(`import sys, os\nsys.path.insert(0, ${JSON.stringify(dir)})\nos.chdir(${JSON.stringify(dir)})`);
    await py.runPythonAsync(code, { globals, filename: entry });
    ok = true;
  } catch (thrown: any) {
    if (phase === 'load') loadMs = Date.now() - started;
    error = String(thrown?.message ?? thrown).replace(/\s+at .*$/s, '').trim();
  }
  post({
    type: 'done',
    requestId,
    ok,
    stdout: stdout.join('\n').replace(/\n$/, ''),
    stderr: stderr.join('\n').replace(/\n$/, ''),
    error,
    phase,
    ms: Date.now() - started,
    loadMs,
  });
};
