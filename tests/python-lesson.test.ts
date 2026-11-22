/**
 * Runs the Python lesson's own code through the local interpreter. The browser
 * runs it on Pyodide, but the code the learner is given, and the mission checks
 * that judge it, are the same — so a real run here catches a lesson that would
 * fail in class.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { evaluateCheck } from '../src/lessons/checks';
import { lessonById } from '../src/lessons';
import type { Lesson, LessonState } from '../src/lessons/types';

const lesson = lessonById('python-hello') as Lesson;

const hasPython = (() => {
  try {
    execFileSync('python3', ['-c', 'print(1)'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

const run = (code: string): string =>
  execFileSync('python3', ['-c', code], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const stateFor = (code: string, stdout: string): LessonState => ({
  runtime: 'python',
  files: { ...lesson.files, 'main.py': code },
  active: 'main.py',
  runs: 1,
  stdout,
  stderr: '',
  history: ['python main.py'],
  lastCommand: 'python main.py',
  gitInitialized: false,
  gitTotalCommits: 0,
  gitMergeCommits: 0,
  gitBranch: null,
  gitBranches: [],
  gitMainTip: null,
});

const check = (missionId: string, state: LessonState) =>
  evaluateCheck(lesson.missions.find((mission) => mission.id === missionId)!.check, state);

describe.skipIf(!hasPython)('Python lesson code, executed for real', () => {
  it('prints the greeting the first mission expects', () => {
    const stdout = run(lesson.files['main.py']);
    expect(stdout).toContain('안녕하세요, 학습자입니다.');
    expect(stdout).toContain('5');
    expect(check('py-run', stateFor(lesson.files['main.py'], stdout))).toBe(true);
  });

  it('passes the name mission once the learner edits name', () => {
    const code = 'name = "CodePlayground"\nprint(f"안녕하세요, {name}입니다.")';
    const stdout = run(code);
    expect(stdout.trim()).toBe('안녕하세요, CodePlayground입니다.');
    expect(check('py-name', stateFor(code, stdout))).toBe(true);
  });

  it('passes the loop mission with 1..5 on separate lines', () => {
    const code = 'for i in range(1, 6):\n    print(i)';
    expect(run(code).trim()).toBe('1\n2\n3\n4\n5');
    expect(check('py-loop', stateFor(code, run(code)))).toBe(true);
  });

  it('passes the sum mission with the practice list', () => {
    const code = 'numbers = [12, 45, 7, 23, 88, 34, 61, 15]\nprint(sum(numbers))';
    expect(run(code).trim()).toBe('285');
    expect(check('py-sum', stateFor(code, run(code)))).toBe(true);
  });
});
