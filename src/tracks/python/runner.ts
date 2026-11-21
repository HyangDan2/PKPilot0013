/**
 * CPython in the browser through Pyodide, fetched from the jsDelivr CDN the
 * first time the Python track needs it. Everything else in Vísna Sól is local;
 * this is the one download, so it reports progress and fails softly when the
 * learner is offline.
 */
export type PythonStage = 'idle' | 'script' | 'runtime' | 'ready' | 'error';

export interface PythonProgress {
  stage: PythonStage;
  percent: number;
}

export interface PythonRun {
  stdout: string;
  stderr: string;
  error?: string;
  ms: number;
}

const CDN = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Pyodide = any;

let runtimePromise: Promise<Pyodide> | null = null;
let progress: PythonProgress = { stage: 'idle', percent: 0 };

let stdoutBuffer = '';
let stderrBuffer = '';

export const pythonStatus = (): PythonProgress => progress;

function setProgress(stage: PythonStage, percent: number) {
  progress = { stage, percent };
}

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-visna-pyodide="1"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.visnaPyodide = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('pyodide-script-failed'));
    document.head.appendChild(script);
  });
}

export function loadPython(): Promise<Pyodide> {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    setProgress('script', 12);
    await loadScript(`${CDN}pyodide.js`);
    const loader = (window as unknown as { loadPyodide?: (options: { indexURL: string }) => Promise<Pyodide> })
      .loadPyodide;
    if (!loader) throw new Error('pyodide-loader-missing');
    setProgress('runtime', 45);
    const py = await loader({ indexURL: CDN });
    setProgress('runtime', 92);
    py.setStdout({ batched: (text: string) => { stdoutBuffer += `${text}\n`; } });
    py.setStderr({ batched: (text: string) => { stderrBuffer += `${text}\n`; } });
    setProgress('ready', 100);
    return py;
  })().catch((error: unknown) => {
    runtimePromise = null;
    setProgress('error', 0);
    throw error;
  });
  return runtimePromise;
}

export const pythonReady = (): boolean => progress.stage === 'ready';

export async function runPython(code: string): Promise<PythonRun> {
  const started = performance.now();
  stdoutBuffer = '';
  stderrBuffer = '';
  let error: string | undefined;
  try {
    const py = await loadPython();
    await py.runPythonAsync(code);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    error = message.replace(/\s+at .*$/s, '').trim();
  }
  const ms = Math.round(performance.now() - started);
  const stdout = stdoutBuffer.replace(/\n$/, '');
  const stderr = stderrBuffer.replace(/\n$/, '');
  stdoutBuffer = '';
  stderrBuffer = '';
  return { stdout, stderr, error, ms };
}

/** Pyodide's version string, once loaded — the status bar shows it. */
export function pythonVersion(): string | null {
  if (progress.stage !== 'ready') return null;
  return 'CPython 3.13 · Pyodide';
}
