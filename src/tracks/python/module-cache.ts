/**
 * Python's module cache is process-wide, and the browser keeps one Pyodide
 * process for the whole lesson. Without clearing it, `import practice` after
 * editing `practice.py` keeps handing back the module object loaded by the
 * *previous* run — the learner's fix appears to do nothing.
 *
 * Each run therefore removes the lesson's own modules (by name, and by the file
 * they were loaded from) from `sys.modules`, drops the previous run directories
 * from `sys.path`, and invalidates the import system's directory caches.
 */

/** Where every run's files are written inside Pyodide's virtual filesystem. */
export const PY_RUN_ROOT = '/tmp/codeplayground';

/**
 * The names a run can import: `practice.py` → `practice`,
 * `helpers/math.py` → `helpers.math`.
 */
export function lessonModuleNames(files: Record<string, string>): string[] {
  const names = Object.keys(files)
    .filter((path) => path.endsWith('.py'))
    .map((path) => path.slice(0, -'.py'.length).replace(/^\/+/, '').replace(/\//g, '.'))
    .filter((name) => name.length > 0 && name.split('.').pop() !== '__init__');
  return [...new Set(names)].sort();
}

/**
 * The Python that resets the interpreter's module state before a run. Kept as a
 * string because it has to travel into the worker, and kept pure so the unit
 * suite can run it against a real Python.
 */
export function moduleResetScript(files: Record<string, string>, root: string = PY_RUN_ROOT): string {
  return [
    'import sys, importlib',
    `_lesson_modules = ${JSON.stringify(lessonModuleNames(files))}`,
    `_run_root = ${JSON.stringify(root)}`,
    'for _name in list(sys.modules):',
    '    _module = sys.modules.get(_name)',
    "    _file = getattr(_module, '__file__', None) or ''",
    '    if _name in _lesson_modules or str(_file).startswith(_run_root):',
    '        sys.modules.pop(_name, None)',
    'sys.path = [p for p in sys.path if not str(p).startswith(_run_root)]',
    'importlib.invalidate_caches()',
    '',
  ].join('\n');
}

/**
 * The Python that deletes every run directory under `root` except `keep`.
 *
 * The interpreter is one process for the whole lesson, so without this each run
 * leaves its files behind and Pyodide's in-memory file system grows for as long
 * as the tab stays open. Removing them is what keeps memory flat.
 */
export function vfsCleanupScript(root: string = PY_RUN_ROOT, keep: string | null = null): string {
  return [
    'import os, shutil',
    `_root = ${JSON.stringify(root)}`,
    `_keep = ${keep === null ? 'None' : JSON.stringify(keep)}`,
    'if os.path.isdir(_root):',
    '    for _name in os.listdir(_root):',
    '        _path = os.path.join(_root, _name)',
    '        if _keep is not None and os.path.abspath(_path) == os.path.abspath(_keep):',
    '            continue',
    '        if os.path.isdir(_path):',
    '            shutil.rmtree(_path, ignore_errors=True)',
    '        else:',
    '            try:',
    '                os.remove(_path)',
    '            except OSError:',
    '                pass',
    '',
  ].join('\n');
}

/** Removes one run directory — the aftermath of a finished or failed run. */
export function runDirectoryCleanupScript(dir: string): string {
  return [
    'import os, shutil, sys',
    `_dir = ${JSON.stringify(dir)}`,
    // Pyodide cannot delete the directory the interpreter is standing in, and a
    // run leaves it there (`os.chdir`). Step out first, then delete.
    'try:',
    "    os.chdir('/')",
    'except OSError:',
    '    pass',
    'if os.path.isdir(_dir):',
    '    shutil.rmtree(_dir, ignore_errors=True)',
    'sys.path = [p for p in sys.path if str(p) != _dir]',
    '',
  ].join('\n');
}
