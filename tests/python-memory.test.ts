/**
 * WO-14 · a Python run must leave nothing behind.
 *
 * The interpreter is one process for the whole lesson, so two things accumulate
 * unless they are released on purpose:
 *  - the run's directory in Pyodide's in-memory file system, and
 *  - the PyProxy objects that wrap the run's namespace.
 *
 * The first half of this file runs the generated cleanup Python against a real
 * `python3`; the second half drives `executeProgram` with a small stand-in for
 * Pyodide and counts what is left after a hundred runs.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runDirectoryCleanupScript,
  vfsCleanupScript,
  PY_RUN_ROOT,
} from '../src/tracks/python/module-cache';
import { executeProgram, runDirectory, type PyodideLike } from '../src/tracks/python/runtime-core';

const hasPython = (() => {
  try {
    execFileSync('python3', ['-c', 'print(1)'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasPython)('WO-14 · the VFS cleanup Python, on a real interpreter', () => {
  const run = (code: string, cwd: string) =>
    execFileSync('python3', ['-c', code], { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] });

  it('removes every run directory except the one in use', () => {
    const root = mkdtempSync(join(tmpdir(), 'cp-vfs-'));
    for (const name of ['run-1', 'run-2', 'run-3']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'main.py'), `print(${JSON.stringify(name)})\n`);
    }
    writeFileSync(join(root, 'stray.txt'), 'left over\n');

    run(vfsCleanupScript(root, join(root, 'run-3')), root);
    expect(readdirSync(root)).toEqual(['run-3']);
    expect(existsSync(join(root, 'run-3', 'main.py'))).toBe(true);
  });

  it('empties the root when no run is in flight', () => {
    const root = mkdtempSync(join(tmpdir(), 'cp-vfs-all-'));
    for (const name of ['run-1', 'run-2']) {
      mkdirSync(join(root, name, 'pkg'), { recursive: true });
      writeFileSync(join(root, name, 'pkg', 'mod.py'), 'value = 1\n');
    }
    run(vfsCleanupScript(root), root);
    expect(readdirSync(root)).toEqual([]);
  });

  it('is harmless when the root does not exist yet', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'cp-vfs-none-')), 'never-created');
    expect(() => run(vfsCleanupScript(root), tmpdir())).not.toThrow();
    expect(existsSync(root)).toBe(false);
  });

  it('drops one finished run directory and its sys.path entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'cp-vfs-one-'));
    const dir = join(root, 'run-7');
    mkdirSync(dir);
    writeFileSync(join(dir, 'main.py'), 'print(7)\n');

    const program = [
      'import sys',
      `sys.path.insert(0, ${JSON.stringify(dir)})`,
      runDirectoryCleanupScript(dir),
      'print(any(p == ' + JSON.stringify(dir) + ' for p in sys.path))',
    ].join('\n');
    expect(run(program, root).trim()).toBe('False');
    expect(existsSync(dir)).toBe(false);
  });
});

/**
 * A minimal Pyodide stand-in: an in-memory file system, the two Python scripts
 * whose effect matters (module reset is a no-op here), and proxies that record
 * whether they were destroyed.
 */
function fakePyodide() {
  const files = new Map<string, string>();
  const created: string[] = [];
  const destroyed: string[] = [];
  const scripts: string[] = [];
  let nextId = 0;

  const mkdirTree = (path: string) => {
    // every ancestor is implicitly there; remember the leaf as a directory
    if (!path.startsWith(PY_RUN_ROOT)) throw new Error(`mkdirTree outside the run root: ${path}`);
    created.push(path);
  };

  const interpreter = {
    FS: {
      mkdirTree,
      writeFile: (path: string, data: string) => {
        files.set(path, data);
      },
    },
    globals: {
      get: (name: string) => {
        expect(name).toBe('dict');
        const factory = {
          make: () => {
            const id = `namespace-${(nextId += 1)}`;
            return {
              id,
              set: (key: string, value: unknown) => files.set(`ns:${id}:${key}`, String(value)),
              destroy: () => destroyed.push(id),
            };
          },
        };
        // `py.globals.get('dict')` hands back a PyProxy too — it must be freed
        const factoryProxy = Object.assign(() => factory.make(), { destroy: () => destroyed.push('factory') });
        return factoryProxy;
      },
    },
    runPython: (code: string) => {
      scripts.push(code);
      // Emulate only the file-system effect of the generated cleanup scripts.
      const single = code.match(/_dir = "([^"]+)"/);
      if (single && code.includes('shutil.rmtree')) {
        for (const path of [...files.keys()]) {
          if (path === single[1] || path.startsWith(`${single[1]}/`)) files.delete(path);
        }
        for (const path of [...created]) if (path === single[1]) created.splice(created.indexOf(path), 1);
      }
      const keep = code.match(/_keep = (None|"[^"]+")/);
      if (keep && code.includes('shutil.rmtree')) {
        const keepPath = keep[1] === 'None' ? null : (JSON.parse(keep[1]) as string);
        for (const path of [...files.keys()]) {
          if (keepPath && (path === keepPath || path.startsWith(`${keepPath}/`))) continue;
          if (path.startsWith(`${PY_RUN_ROOT}/`)) files.delete(path);
        }
      }
      return undefined;
    },
    runPythonAsync: async (code: string, options?: Record<string, unknown>) => {
      scripts.push(`async:${code}`);
      const namespace = options?.globals as { id: string } | undefined;
      if (code.includes('raise')) throw new Error('ValueError: boom');
      files.set(`ns:${namespace?.id}:output`, code);
      return undefined;
    },
    setStdout: (options: { batched: (text: string) => void }) => {
      // the program writes through these in the real runtime
      if (typeof options.batched !== 'function') throw new Error('setStdout needs a batched handler');
    },
    setStderr: (options: { batched: (text: string) => void }) => {
      if (typeof options.batched !== 'function') throw new Error('setStderr needs a batched handler');
    },
  };

  return { interpreter: interpreter as unknown as PyodideLike, files, created, destroyed, scripts };
}

describe('WO-14 · a run releases its namespace and its directory', () => {
  it('destroys both proxies and removes the directory when the program ends', async () => {
    const fake = fakePyodide();
    const output: string[] = [];
    await executeProgram(fake.interpreter, {
      code: 'print(1)',
      files: { 'main.py': 'print(1)' },
      entry: 'main.py',
      dir: runDirectory(1),
      onStdout: (text) => output.push(text),
      onStderr: () => undefined,
    });

    expect(fake.destroyed).toEqual(['namespace-1', 'factory']);
    expect([...fake.files.keys()].filter((path) => path.startsWith(`${PY_RUN_ROOT}/`))).toEqual([]);
    // the module table and the run directories were reset for this run
    expect(fake.scripts.some((script) => script.includes('importlib.invalidate_caches()'))).toBe(true);
    expect(fake.scripts.some((script) => script.includes('_keep = '))).toBe(true);
    expect(output).toEqual([]);
  });

  it('releases them just the same when the program raises', async () => {
    const fake = fakePyodide();
    await expect(
      executeProgram(fake.interpreter, {
        code: 'raise ValueError("boom")',
        files: { 'main.py': 'raise ValueError("boom")' },
        entry: 'main.py',
        dir: runDirectory(2),
        onStdout: () => undefined,
        onStderr: () => undefined,
      }),
    ).rejects.toThrow('boom');

    expect(fake.destroyed).toEqual(['namespace-1', 'factory']);
    expect([...fake.files.keys()].filter((path) => path.startsWith(`${PY_RUN_ROOT}/`))).toEqual([]);
  });

  it('leaves nothing behind over a hundred runs', async () => {
    const fake = fakePyodide();
    for (let i = 0; i < 120; i += 1) {
      await executeProgram(fake.interpreter, {
        code: 'print(1)',
        files: { 'main.py': 'print(1)', 'practice.py': 'value = 1\n' },
        entry: 'main.py',
        dir: runDirectory(i + 1),
        onStdout: () => undefined,
        onStderr: () => undefined,
      });
    }

    // every namespace proxy was destroyed — nothing accumulated in the JS heap
    expect(fake.destroyed.filter((id) => id.startsWith('namespace-'))).toHaveLength(120);
    expect(fake.destroyed.filter((id) => id === 'factory')).toHaveLength(120);
    expect(fake.destroyed).toHaveLength(240);
    // and no run directory survived on the virtual file system
    expect([...fake.files.keys()].filter((path) => path.startsWith(`${PY_RUN_ROOT}/`))).toEqual([]);
    expect(fake.created).toEqual([]);
  });
});
