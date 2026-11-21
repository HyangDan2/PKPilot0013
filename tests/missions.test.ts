import { describe, expect, it } from 'vitest';
import { GitRepo, gitSeed } from '../src/tracks/git/repo';
import { Shell } from '../src/tracks/linux/shell';
import { gitMissions, linuxMissions, pythonMissions, type LinuxMissionState } from '../src/tracks/missions';
import { TRACKS } from '../src/tracks';

describe('git missions', () => {
  it('walks a learner from init to rebase', () => {
    const repo = new GitRepo(gitSeed());
    const check = (id: string) => gitMissions.find((mission) => mission.id === id)?.check(repo.snapshot());

    expect(check('git-init')).toBe(false);
    repo.exec('git init');
    expect(check('git-init')).toBe(true);

    repo.workdir['app.js'] = `${repo.workdir['app.js']}\n// 첫 변경`;
    repo.exec('git add .');
    expect(check('git-first-commit')).toBe(false);
    repo.exec('git commit -m "첫 커밋"');
    expect(check('git-first-commit')).toBe(true);

    repo.exec('git switch -c feature');
    repo.workdir['feature.txt'] = 'x\n';
    repo.exec('git add .');
    repo.exec('git commit -m "기능 추가"');
    expect(check('git-branch')).toBe(true);

    repo.exec('git switch main');
    repo.workdir['README.md'] = `${repo.workdir['README.md']}\nmain`;
    repo.exec('git add .');
    repo.exec('git commit -m "main 작업"');
    expect(check('git-merge')).toBe(false);
    repo.exec('git merge feature');
    expect(check('git-merge')).toBe(true);

    repo.exec('git switch -c tidy feature');
    repo.workdir['tidy.txt'] = 'tidy\n';
    repo.exec('git add .');
    repo.exec('git commit -m "정리"');
    expect(check('git-rebase')).toBe(false);
    repo.exec('git rebase main');
    expect(check('git-rebase')).toBe(true);
  });
});

describe('linux missions', () => {
  it('passes each mission only after the real command ran', () => {
    const shell = new Shell();
    const state = (lastCommand: string, lastStdout: string): LinuxMissionState => ({
      tree: shell.snapshot().tree,
      cwd: shell.cwdPath(),
      history: shell.history,
      lastCommand,
      lastStdout,
    });
    const check = (id: string, lastCommand: string, lastStdout = '') =>
      linuxMissions.find((mission) => mission.id === id)?.check(state(lastCommand, lastStdout)) ?? false;

    expect(check('linux-look', '')).toBe(false);
    shell.exec('pwd');
    expect(check('linux-look', 'pwd', '/home/learner/work')).toBe(false);
    const ls = shell.exec('ls -la');
    expect(check('linux-look', 'ls -la', ls.lines.map((line) => line.text).join('\n'))).toBe(true);

    expect(check('linux-mkdir', 'ls')).toBe(false);
    shell.exec('mkdir practice');
    expect(check('linux-mkdir', 'mkdir practice')).toBe(false);
    shell.exec('touch practice/todo.txt');
    expect(check('linux-mkdir', 'touch practice/todo.txt')).toBe(true);

    expect(check('linux-echo', 'touch practice/todo.txt')).toBe(false);
    shell.exec('echo "리눅스 연습" > practice/todo.txt');
    expect(check('linux-echo', 'echo "리눅스 연습" > practice/todo.txt')).toBe(true);

    const piped = shell.exec('cat ~/logs/access.log | grep 404 | wc -l');
    expect(check('linux-pipe', 'cat ~/logs/access.log | grep 404 | wc -l', piped.lines.map((line) => line.text).join('\n'))).toBe(true);
    expect(check('linux-pipe', 'ls', '3')).toBe(false);

    const found = shell.exec('find . -name "*.md"');
    expect(check('linux-find', 'find . -name "*.md"', found.lines.map((line) => line.text).join('\n'))).toBe(true);
  });
});

describe('python missions', () => {
  const base = { activePath: 'hello.py', lastStderr: '', runs: 1 };

  it('requires the real output, not just a click', () => {
    const empty = { ...base, files: { 'hello.py': 'print("x")' }, lastStdout: '' };
    expect(pythonMissions[0].check(empty as never)).toBe(false);

    const ran = { ...base, files: { 'hello.py': 'print("x")' }, lastStdout: 'x' };
    expect(pythonMissions[0].check(ran as never)).toBe(true);

    const fstring = {
      ...base,
      files: { 'hello.py': 'name = "Vísna Sól"\nprint(f"안녕하세요, {name}입니다.")' },
      lastStdout: '안녕하세요, Vísna Sól입니다.',
    };
    expect(pythonMissions[1].check(fstring as never)).toBe(true);
    expect(pythonMissions[1].check(ran as never)).toBe(false);

    const looped = {
      ...base,
      files: { 'loops.py': 'for i in range(1, 6):\n    print(i)' },
      lastStdout: '1\n2\n3\n4\n5',
    };
    expect(pythonMissions[2].check(looped as never)).toBe(true);
    expect(pythonMissions[2].check({ ...looped, lastStdout: '1\n2\n3' } as never)).toBe(false);

    const summed = { ...base, files: { 'numbers.py': 'print(sum(numbers))' }, lastStdout: '285' };
    expect(pythonMissions[3].check(summed as never)).toBe(true);

    const averaged = {
      ...base,
      files: { 'numbers.py': 'def average(values):\n    return sum(values) / len(values)\nprint(f"{average(numbers):.2f}")' },
      lastStdout: '35.63',
    };
    expect(pythonMissions[4].check(averaged as never)).toBe(true);
    expect(pythonMissions[4].check(summed as never)).toBe(false);
  });
});

describe('track seeds', () => {
  it('start from files that do not already satisfy a mission', () => {
    const python = TRACKS.python.files();
    expect(python['numbers.py']).not.toContain('285');
    expect(python['loops.py']).not.toContain('range(1, 6)');
    const git = TRACKS.git.files();
    expect(Object.keys(git)).toContain('README.md');
    const linux = TRACKS.linux.files();
    expect(linux['script.sh']).toContain('pwd');
  });
});
