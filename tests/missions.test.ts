import { describe, expect, it } from 'vitest';
import { GitRepo } from '../src/tracks/git/repo';
import { evaluateCheck } from '../src/lessons/checks';
import { gitFields } from '../src/lessons/state';
import { lessonById } from '../src/lessons';
import type { Lesson, LessonMission, LessonState } from '../src/lessons/types';

const lesson = (id: string): Lesson => {
  const found = lessonById(id);
  if (!found) throw new Error(`missing lesson ${id}`);
  return found;
};

const mission = (id: string, missionId: string): LessonMission => {
  const found = lesson(id).missions.find((item) => item.id === missionId);
  if (!found) throw new Error(`missing mission ${missionId}`);
  return found;
};

const passes = (id: string, missionId: string, state: LessonState) => evaluateCheck(mission(id, missionId).check, state);

const pythonState = (lessonId: string, overrides: Partial<LessonState> = {}): LessonState => ({
  runtime: 'python',
  files: { ...lesson(lessonId).files },
  active: lesson(lessonId).entry,
  runs: 0,
  stdout: '',
  stderr: '',
  history: [],
  lastCommand: '',
  gitInitialized: false,
  gitTotalCommits: 0,
  gitMergeCommits: 0,
  gitBranch: null,
  gitBranches: [],
  gitMainTip: null,
  ...overrides,
});

const gitState = (lessonId: string, repo: GitRepo, overrides: Partial<LessonState> = {}): LessonState => ({
  runtime: 'git',
  files: { ...lesson(lessonId).files },
  active: lesson(lessonId).entry,
  runs: 0,
  stdout: '',
  stderr: '',
  history: [],
  lastCommand: '',
  ...gitFields(repo.snapshot()),
  ...overrides,
});

describe('Python lesson missions', () => {
  it('starts with nothing complete and passes "run" only after a run with output', () => {
    const cold = pythonState('python-hello');
    expect(passes('python-hello', 'py-run', cold)).toBe(false);
    const ran = { ...pythonState('python-hello'), runs: 1, stdout: '안녕하세요, 학습자입니다.\n5' };
    expect(passes('python-hello', 'py-run', ran)).toBe(true);
  });

  it('wants the learner’s own name in both the file and the output', () => {
    const edited = pythonState('python-hello', {
      files: { ...lesson('python-hello').files, 'main.py': 'name = "CodePlayground"\nprint(f"안녕하세요, {name}입니다.")' },
      runs: 1,
      stdout: '안녕하세요, CodePlayground입니다.',
    });
    expect(passes('python-hello', 'py-name', edited)).toBe(true);
    expect(passes('python-hello', 'py-name', pythonState('python-hello', { runs: 1, stdout: '안녕하세요, 학습자입니다.' }))).toBe(false);
  });

  it('accepts a loop only when 1..5 are printed and a for loop exists', () => {
    const loop = pythonState('python-hello', {
      files: { ...lesson('python-hello').files, 'main.py': 'for i in range(1, 6):\n    print(i)' },
      runs: 1,
      stdout: '1\n2\n3\n4\n5',
    });
    expect(passes('python-hello', 'py-loop', loop)).toBe(true);
    expect(passes('python-hello', 'py-loop', { ...loop, stdout: '1\n2\n3' })).toBe(false);
    expect(passes('python-hello', 'py-loop', { ...loop, files: { 'main.py': 'print(1)' } })).toBe(false);
  });

  it('accepts the sum when 285 is printed by code that calls sum()', () => {
    const sum = pythonState('python-hello', {
      files: { ...lesson('python-hello').files, 'practice.py': 'print(sum([12, 45, 7, 23, 88, 34, 61, 15]))' },
      runs: 1,
      stdout: '285',
    });
    expect(passes('python-hello', 'py-sum', sum)).toBe(true);
    expect(passes('python-hello', 'py-sum', { ...sum, stdout: '284' })).toBe(false);
  });
});

describe('Git lesson missions', () => {
  const repo = () => new GitRepo({ ...lesson('git-basics').files });
  const commitAll = (target: GitRepo, message: string) => {
    target.exec('git add .');
    target.exec(`git commit -m "${message}"`);
  };

  it('walks init → commit → branch → merge, and nothing passes early', () => {
    const target = repo();
    expect(passes('git-basics', 'git-init', gitState('git-basics', target))).toBe(false);
    expect(passes('git-basics', 'git-first-commit', gitState('git-basics', target))).toBe(false);

    target.exec('git init');
    const initialized = gitState('git-basics', target);
    expect(passes('git-basics', 'git-init', initialized)).toBe(true);
    expect(passes('git-basics', 'git-first-commit', initialized)).toBe(false);
    expect(passes('git-basics', 'git-branch', initialized)).toBe(false);

    commitAll(target, '첫 커밋');
    expect(passes('git-basics', 'git-first-commit', gitState('git-basics', target))).toBe(true);

    target.exec('git switch -c feature');
    expect(passes('git-basics', 'git-branch', gitState('git-basics', target))).toBe(false);
    target.workdir['hello.txt'] = `${target.workdir['hello.txt']}\nfeature 작업`;
    target.exec('git add .');
    target.exec('git commit -m "기능 추가"');
    expect(passes('git-basics', 'git-branch', gitState('git-basics', target))).toBe(true);

    target.exec('git switch main');
    target.workdir['notes.md'] = `${target.workdir['notes.md']}\n- main 작업`;
    target.exec('git add .');
    target.exec('git commit -m "main 작업"');
    expect(passes('git-basics', 'git-merge', gitState('git-basics', target))).toBe(false);
    target.exec('git merge feature');
    expect(passes('git-basics', 'git-merge', gitState('git-basics', target))).toBe(true);
  });

  it('does not count a branch that still points at main', () => {
    const target = repo();
    target.exec('git init');
    commitAll(target, 'base');
    target.exec('git branch feature');
    expect(passes('git-basics', 'git-branch', gitState('git-basics', target))).toBe(false);
  });
});
