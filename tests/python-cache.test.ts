/**
 * The Python module cache reset (P1): an edited lesson module must be imported
 * fresh on the next run.
 *
 * Two layers are checked — that the names/script are built correctly, and that
 * the generated Python really does clear a module that Python already imported.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lessonModuleNames, moduleResetScript, PY_RUN_ROOT } from '../src/tracks/python/module-cache';
import { lessonById } from '../src/lessons';
import type { Lesson } from '../src/lessons/types';

const hasPython = (() => {
  try {
    execFileSync('python3', ['-c', 'print(1)'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

describe('lesson module names', () => {
  it('turns lesson files into the names a program can import', () => {
    expect(lessonModuleNames({ 'main.py': '', 'practice.py': '', 'notes.md': '' })).toEqual(['main', 'practice']);
    expect(lessonModuleNames({ 'helpers/math.py': '', 'package/__init__.py': '' })).toEqual(['helpers.math']);
    expect(lessonModuleNames({ 'README.md': '', 'data.txt': '' })).toEqual([]);
  });

  it('names the run root and every lesson module in the reset script', () => {
    const script = moduleResetScript({ 'main.py': '', 'practice.py': '' });
    expect(script).toContain('importlib.invalidate_caches()');
    expect(script).toContain(JSON.stringify(['main', 'practice']));
    expect(script).toContain(PY_RUN_ROOT);
    expect(script).toContain('sys.modules.pop');
  });
});

describe.skipIf(!hasPython)('the reset script, executed by a real interpreter', () => {
  const run = (code: string, cwd: string) =>
    execFileSync('python3', ['-c', code], { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] });

  it('re-imports an edited module instead of the cached one', () => {
    const root = mkdtempSync(join(tmpdir(), 'cp-cache-'));
    const dir = join(root, 'run-1');
    execFileSync('mkdir', ['-p', dir]);
    writeFileSync(join(dir, 'practice.py'), 'value = "첫 번째"\n');

    // One interpreter session: import, edit the file, reset (as the worker does
    // before the next run), then import again from the new run directory.
    const program = [
      'import sys',
      `sys.path.insert(0, ${JSON.stringify(dir)})`,
      'import practice',
      'print(practice.value)',
      `open(${JSON.stringify(join(dir, 'practice.py'))}, 'w').write('value = "이제 고친 값이다"\\n')`,
      moduleResetScript({ 'practice.py': '' }, root),
      `sys.path.insert(0, ${JSON.stringify(dir)})`,
      'import practice',
      'print(practice.value)',
    ].join('\n');

    // The replacement is deliberately a different length: CPython also keys its
    // bytecode cache on (mtime, size), and that is not what this test measures.
    expect(run(program, dir).trim()).toBe('첫 번째\n이제 고친 값이다');
  });

  it('drops modules loaded from an earlier run directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'cp-roots-'));
    const first = join(root, 'run-1');
    const second = join(root, 'run-2');
    for (const [dir, value] of [
      [first, '처음'],
      [second, '다음'],
    ] as const) {
      execFileSync('mkdir', ['-p', dir]);
      writeFileSync(join(dir, 'practice.py'), `value = "${value}"\n`);
    }

    const program = [
      'import sys',
      `sys.path.insert(0, ${JSON.stringify(first)})`,
      'import practice',
      'print(practice.value)',
      moduleResetScript({ 'practice.py': '' }, root),
      `sys.path.insert(0, ${JSON.stringify(second)})`,
      'import practice',
      'print(practice.value)',
      // the previous run directories were dropped from sys.path as well
      `print(any(str(p).startswith(${JSON.stringify(root)}) for p in sys.path[1:]))`,
    ].join('\n');

    expect(run(program, second).trim()).toBe('처음\n다음\nFalse');
  });

  it('matches the lesson the Python track ships', () => {
    const lesson = lessonById('python-hello') as Lesson;
    expect(lessonModuleNames(lesson.files)).toContain('practice');
  });
});
