import { describe, expect, it } from 'vitest';
import { GitRepo, gitSeed } from '../src/tracks/git/repo';
import { layoutGraph } from '../src/tracks/git/graph';
import { diffFile } from '../src/tracks/git/diff';

const text = (repo: GitRepo, command: string) =>
  repo
    .exec(command)
    .lines.map((line) => line.text)
    .join('\n');

const bootstrap = () => {
  const repo = new GitRepo(gitSeed());
  repo.exec('git init');
  return repo;
};

const commitAll = (repo: GitRepo, message: string) => {
  repo.exec('git add .');
  return repo.exec(`git commit -m "${message}"`);
};

describe('git engine', () => {
  it('refuses commands before init and initialises on main', () => {
    const repo = new GitRepo(gitSeed());
    const before = repo.exec('git status');
    expect(before.exit).toBe(1);
    expect(before.lines[0].text).toContain('not a git repository');

    const init = repo.exec('git init');
    expect(init.exit).toBe(0);
    expect(repo.initialized).toBe(true);
    expect(repo.branches.main).toBeNull();

    const status = text(repo, 'git status');
    expect(status).toContain('On branch main');
    expect(status).toContain('Untracked files:');
    expect(status).toContain('README.md');
  });

  it('stages, commits and reports the commit stat', () => {
    const repo = bootstrap();
    repo.workdir['app.js'] = `${repo.workdir['app.js']}\n// 한 줄 추가`;
    repo.exec('git add app.js');

    const staged = repo.snapshot().staged;
    expect(staged).toEqual([{ path: 'app.js', status: 'added' }]);

    const commit = commitAll(repo, '첫 커밋');
    expect(commit.exit).toBe(0);
    expect(commit.lines[0].text).toMatch(/^\[main [0-9a-f]{7,8}\] 첫 커밋$/);
    expect(repo.snapshot().totalCommits).toBe(1);
    expect(repo.snapshot().untracked).toEqual([]);

    const log = text(repo, 'git log --oneline');
    expect(log).toContain('첫 커밋');
    expect(log).toMatch(/HEAD -> main/);
  });

  it('rejects an empty commit and an empty message', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    const clean = repo.exec('git commit -m "again"');
    expect(clean.exit).toBe(1);
    expect(clean.lines.map((line) => line.text).join(' ')).toContain('nothing to commit');

    const empty = repo.exec('git commit -m ""');
    expect(empty.exit).toBe(1);
    expect(empty.lines[0].text).toContain('empty commit message');
  });

  it('creates a branch, switches to it and merges it back with a merge commit', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');

    repo.exec('git switch -c feature');
    expect(repo.branch).toBe('feature');
    repo.workdir['feature.txt'] = 'feature work\n';
    commitAll(repo, 'feature 작업');

    repo.exec('git switch main');
    repo.workdir['README.md'] = `${repo.workdir['README.md']}\nmain 쪽 변경`;
    commitAll(repo, 'main 작업');

    const merge = repo.exec('git merge feature');
    expect(merge.exit).toBe(0);
    expect(merge.lines.map((line) => line.text).join('\n')).toContain("Merge made by the 'ort' strategy.");

    const snap = repo.snapshot();
    expect(snap.totalCommits).toBe(4);
    expect(snap.stats.merges).toBe(1);
    expect(snap.commits.some((commit) => commit.parents.length === 2)).toBe(true);
    expect(repo.workdir['feature.txt']).toBe('feature work\n');
    expect(repo.workdir['README.md']).toContain('main 쪽 변경');
  });

  it('fast-forwards when main has not moved', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.exec('git switch -c fast');
    repo.workdir['fast.txt'] = 'x\n';
    commitAll(repo, 'fast 작업');
    repo.exec('git switch main');
    const merge = repo.exec('git merge fast');
    expect(merge.exit).toBe(0);
    expect(merge.lines.map((line) => line.text)).toContain('Fast-forward');
    expect(repo.snapshot().stats.merges).toBe(0);
    expect(repo.workdir['fast.txt']).toBe('x\n');
  });

  it('stops a conflicting merge and leaves conflict markers', () => {
    const repo = bootstrap();
    repo.workdir['app.js'] = 'shared line\n';
    commitAll(repo, 'base');

    repo.exec('git switch -c feature');
    repo.workdir['app.js'] = 'feature line\n';
    commitAll(repo, 'feature 변경');

    repo.exec('git switch main');
    repo.workdir['app.js'] = 'main line\n';
    commitAll(repo, 'main 변경');

    const merge = repo.exec('git merge feature');
    expect(merge.exit).toBe(1);
    expect(merge.lines.map((line) => line.text).join('\n')).toContain('CONFLICT (content): Merge conflict in app.js');
    expect(repo.workdir['app.js']).toContain('<<<<<<< HEAD');
    expect(repo.mergePending).toBe('feature');
  });

  it('rebases a branch onto main and keeps the history linear', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');

    repo.exec('git switch -c topic');
    repo.workdir['topic.txt'] = 'topic\n';
    commitAll(repo, 'topic 커밋');

    repo.exec('git switch main');
    repo.workdir['main.txt'] = 'main\n';
    commitAll(repo, 'main 커밋');
    const mainSha = repo.branches.main;

    repo.exec('git switch topic');
    const rebase = repo.exec('git rebase main');
    expect(rebase.exit).toBe(0);
    expect(rebase.lines.map((line) => line.text).join('\n')).toContain('Applying: topic 커밋');
    expect(repo.stats.rebases).toBe(1);

    const tip = repo.commits[repo.branches.topic as string];
    expect(tip.parents).toEqual([mainSha]);
    expect(tip.message).toBe('topic 커밋');
    expect(repo.workdir['main.txt']).toBe('main\n');
    expect(repo.workdir['topic.txt']).toBe('topic\n');
  });

  it('resets the branch, index and working tree per mode', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    const baseSha = repo.branches.main as string;
    repo.workdir['later.txt'] = 'later\n';
    commitAll(repo, 'later');

    repo.exec('git reset --soft HEAD~1');
    expect(repo.branches.main).toBe(baseSha);
    expect(repo.index['later.txt']).toBe('later\n');

    repo.exec('git reset --hard HEAD');
    expect(repo.workdir['later.txt']).toBeUndefined();
    expect(repo.index['later.txt']).toBeUndefined();
  });

  it('cherry-picks a commit onto another branch', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.exec('git switch -c source');
    repo.workdir['picked.txt'] = 'picked\n';
    commitAll(repo, '고른 커밋');
    const picked = repo.branches.source as string;

    repo.exec('git switch main');
    const pick = repo.exec(`git cherry-pick ${picked}`);
    expect(pick.exit).toBe(0);
    expect(repo.workdir['picked.txt']).toBe('picked\n');
    const tip = repo.commits[repo.branches.main as string];
    expect(tip.message).toBe('고른 커밋');
    expect(tip.sha).not.toBe(picked);
  });

  it('prints a unified diff for working tree and staged changes', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.workdir['app.js'] = 'let count = 1;\n';
    const diff = text(repo, 'git diff');
    expect(diff).toContain('--- a/app.js');
    expect(diff).toContain('+++ b/app.js');
    expect(diff).toContain('-let count = 0;');
    expect(diff).toContain('+let count = 1;');
    expect(text(repo, 'git diff --staged')).toBe('');
    repo.exec('git add .');
    expect(text(repo, 'git diff --staged')).toContain('+let count = 1;');
  });

  it('guards a switch that would overwrite local changes', () => {
    const repo = bootstrap();
    repo.workdir['app.js'] = 'one\n';
    commitAll(repo, 'base');
    repo.exec('git switch -c other');
    repo.workdir['app.js'] = 'two\n';
    commitAll(repo, 'other');
    repo.exec('git switch main');
    repo.workdir['app.js'] = 'dirty\n';
    const blocked = repo.exec('git switch other');
    expect(blocked.exit).toBe(1);
    expect(blocked.lines.map((line) => line.text).join(' ')).toContain('local changes');
    expect(repo.branch).toBe('main');
  });

  it('deletes a merged branch', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.exec('git switch -c merged');
    repo.exec('git switch main');
    repo.exec('git merge merged');
    const del = repo.exec('git branch -d merged');
    expect(del.exit).toBe(0);
    expect(repo.branches.merged).toBeUndefined();
  });
});

describe('git graph layout', () => {
  it('gives a linear history one lane and a merge a second lane', () => {
    const linear = layoutGraph([
      { sha: 'aaa', message: 'one', parents: [], time: 1, refs: [] },
      { sha: 'bbb', message: 'two', parents: ['aaa'], time: 2, refs: ['main'] },
    ]);
    expect(linear.laneCount).toBe(1);
    expect(linear.nodes[0].sha).toBe('bbb');
    expect(linear.edges).toHaveLength(1);

    const merged = layoutGraph([
      { sha: 'c1', message: 'base', parents: [], time: 1, refs: [] },
      { sha: 'c2', message: 'side', parents: ['c1'], time: 2, refs: ['feature'] },
      { sha: 'c3', message: 'main', parents: ['c1'], time: 3, refs: [] },
      { sha: 'm', message: 'merge', parents: ['c3', 'c2'], time: 4, refs: ['main'] },
    ]);
    expect(merged.laneCount).toBeGreaterThanOrEqual(2);
    expect(merged.rowCount).toBe(4);
    expect(merged.edges.filter((edge) => edge.fromRow === merged.rowOf.m)).toHaveLength(2);
  });
});

describe('diff', () => {
  it('marks added and deleted files', () => {
    expect(diffFile('new.txt', undefined, 'a\n').mode).toBe('added');
    expect(diffFile('gone.txt', 'a\n', undefined).mode).toBe('deleted');
    const modified = diffFile('app.js', 'a\nb\nc\n', 'a\nB\nc\n');
    expect(modified.additions).toBe(1);
    expect(modified.deletions).toBe(1);
    expect(modified.hunks.join('\n')).toContain('@@ -1,3 +1,3 @@');
  });
});
