/**
 * The per-run lifecycle inside Pyodide, kept apart from the worker's message
 * plumbing so the same code can be exercised outside a browser.
 *
 * What a run must leave behind: nothing. The interpreter outlives the run, so
 * every object this module creates (the namespace dict, the bound `dict` proxy)
 * is destroyed in `finally`, and the run's directory is removed from Pyodide's
 * in-memory file system — otherwise a lesson run a hundred times accumulates a
 * hundred directories and a hundred proxies.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  PY_RUN_ROOT,
  moduleResetScript,
  runDirectoryCleanupScript,
  vfsCleanupScript,
} from './module-cache';

/** The slice of Pyodide this module needs. */
export interface PyodideLike {
  FS: {
    mkdirTree: (path: string) => void;
    writeFile: (path: string, data: string) => void;
  };
  globals: { get: (name: string) => any };
  runPython: (code: string, options?: Record<string, unknown>) => any;
  runPythonAsync: (code: string, options?: Record<string, unknown>) => Promise<any>;
  setStdout: (options: { batched: (text: string) => void }) => void;
  setStderr: (options: { batched: (text: string) => void }) => void;
}

export interface ProgramRun {
  code: string;
  files: Record<string, string>;
  entry: string;
  /** The run's private directory under `/tmp/codeplayground`. */
  dir: string;
  onStdout: (text: string) => void;
  onStderr: (text: string) => void;
}

/** Where run `id` keeps its files. */
export function runDirectory(id: number, root: string = PY_RUN_ROOT): string {
  return `${root}/run-${id}`;
}

/** Writes the editor's files into the interpreter's virtual file system. */
export function writeTree(py: PyodideLike, dir: string, files: Record<string, string>): void {
  py.FS.mkdirTree(dir);
  for (const [name, content] of Object.entries(files)) {
    const path = `${dir}/${name}`;
    const parent = path.slice(0, path.lastIndexOf('/'));
    if (parent && parent !== dir) py.FS.mkdirTree(parent);
    py.FS.writeFile(path, content);
  }
}

/** Drops the lesson's cached modules and the directories of earlier runs. */
export function resetInterpreter(py: PyodideLike, files: Record<string, string>, dir: string): void {
  py.runPython(moduleResetScript(files, PY_RUN_ROOT));
  py.runPython(vfsCleanupScript(PY_RUN_ROOT, dir));
}

/** Removes this run's directory and its `sys.path` entry, whatever happened. */
export function discardRunDirectory(py: PyodideLike, dir: string): void {
  try {
    py.runPython(runDirectoryCleanupScript(dir));
  } catch {
    /* the interpreter may be gone (worker restart); the whole FS went with it */
  }
}

function destroy(value: any): void {
  try {
    value?.destroy?.();
  } catch {
    /* already destroyed, or not a proxy */
  }
}

/**
 * Runs one program and always tidies up after it: the namespace proxies are
 * destroyed and the run directory removed, whether the program finished, raised
 * or could not start at all.
 */
export async function executeProgram(py: PyodideLike, run: ProgramRun): Promise<void> {
  const dictFactory = py.globals.get('dict');
  let namespace: any = null;
  try {
    // A private namespace per run: the same name defined twice does not leak.
    namespace = dictFactory();
    namespace.set('__name__', '__main__');
    namespace.set('__file__', run.entry);
    writeTree(py, run.dir, run.files);
    py.setStdout({ batched: run.onStdout });
    py.setStderr({ batched: run.onStderr });
    // The interpreter is shared between runs, so its module table is not:
    // drop the lesson's modules loaded by an earlier run, and the earlier run
    // directories, so an edited practice.py is really re-imported.
    resetInterpreter(py, run.files, run.dir);
    // `import practice` finds the lesson files because the run directory is on
    // sys.path, and open('data.txt') resolves there too.
    py.runPython(`import sys, os\nsys.path.insert(0, ${JSON.stringify(run.dir)})\nos.chdir(${JSON.stringify(run.dir)})`);
    await py.runPythonAsync(run.code, { globals: namespace, filename: run.entry });
  } finally {
    discardRunDirectory(py, run.dir);
    destroy(namespace);
    destroy(dictFactory);
  }
}
