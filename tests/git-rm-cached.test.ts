/**
 * WO-17 · `git rm --cached` removes a file from the index and nothing else.
 *
 * The file stays on disk as an untracked file — `git status` shows the staged
 * deletion *and* the untracked file, exactly like real git — so a learner can
 * commit the removal and keep (or re-add) their copy.
 */
import { describe, expect, it } from 'vitest';
import { GitRepo, gitSeed } from '../src/tracks/git/repo';

const bootstrap = () => {
  const repo = new GitRepo({ ...gitSeed(), 'keep.txt': 'v1\n', 'other.txt': 'other\n' });
  repo.exec('git init');
  repo.exec('git add .');
  repo.exec('git commit -m "base"');
  return repo;
};

const text = (repo: GitRepo, command: string) =>
  repo
    .exec(command)
    .lines.map((line) => line.text)
    .join('\n');

describe('WO-17 · git rm --cached', () => {
  it('drops the index entry and leaves the file untracked in the working tree', () => {
    const repo = bootstrap();
    const rm = repo.exec('git rm --cached keep.txt');
    expect(rm.exit).toBe(0);
    expect(repo.index['keep.txt']).toBeUndefined();
    expect(repo.workdir['keep.txt']).toBe('v1\n');

    const snap = repo.snapshot();
    expect(snap.staged).toEqual([{ path: 'keep.txt', status: 'deleted' }]);
    expect(snap.unstaged).toEqual([]);
    expect(snap.untracked).toEqual(['keep.txt']);
    // and the editor keeps showing the file
    expect(Object.keys(repo.workdir)).toContain('keep.txt');
  });

  it('shows the deletion and the untracked file together in git status', () => {
    const repo = bootstrap();
    repo.exec('git rm --cached keep.txt');
    const status = text(repo, 'git status');
    expect(status).toContain('Changes to be committed:');
    expect(status).toContain('deleted:   keep.txt');
    expect(status).toContain('Untracked files:');
    expect(status.split('Untracked files:')[1]).toContain('keep.txt');
  });

  it('commits the removal and keeps the file on disk as untracked', () => {
    const repo = bootstrap();
    repo.exec('git rm --cached keep.txt');
    expect(repo.exec('git commit -m "stop tracking keep.txt"').exit).toBe(0);

    expect(repo.headTree()['keep.txt']).toBeUndefined();
    expect(repo.workdir['keep.txt']).toBe('v1\n');
    expect(repo.snapshot().untracked).toEqual(['keep.txt']);
    expect(repo.snapshot().staged).toEqual([]);
  });

  it('puts the file back under version control with git add', () => {
    const repo = bootstrap();
    repo.exec('git rm --cached keep.txt');
    expect(repo.exec('git add keep.txt').exit).toBe(0);
    expect(repo.index['keep.txt']).toBe('v1\n');
    expect(repo.snapshot().untracked).not.toContain('keep.txt');
    expect(repo.snapshot().staged).toEqual([]);
  });

  it('refuses to drop an index entry that holds uncommitted content', () => {
    const repo = bootstrap();
    repo.workdir['keep.txt'] = 'edited\n';
    const refused = repo.exec('git rm --cached keep.txt');
    expect(refused.exit).toBe(1);
    expect(refused.lines.map((line) => line.text).join('\n')).toContain('have local modifications');
    expect(repo.index['keep.txt']).toBe('v1\n');
    expect(repo.workdir['keep.txt']).toBe('edited\n');

    // forcing it keeps the working copy, only the index entry goes
    expect(repo.exec('git rm --cached -f keep.txt').exit).toBe(0);
    expect(repo.workdir['keep.txt']).toBe('edited\n');
    expect(repo.snapshot().untracked).toEqual(['keep.txt']);
  });

  it('keeps an untracked file a file the index never had, not a modified one', () => {
    const repo = bootstrap();
    repo.exec('git rm --cached keep.txt');
    expect(repo.snapshot().initialized).toBe(true);
    expect(repo.snapshot().unstaged.map((entry) => entry.path)).not.toContain('keep.txt');
    expect(repo.untrackedFiles()).toEqual(['keep.txt']);
    // untracked work still follows the learner across a branch switch untouched
    expect(repo.exec('git switch -c feature').exit).toBe(0);
    repo.workdir['keep.txt'] = 'mine\n';
    expect(repo.exec('git switch main').exit).toBe(0);
    expect(repo.workdir['keep.txt']).toBe('mine\n');
  });

  it('is all or nothing across several paths', () => {
    const repo = bootstrap();
    const before = { index: { ...repo.index }, workdir: { ...repo.workdir } };
    expect(repo.exec('git rm --cached keep.txt nope.txt').exit).toBe(1);
    expect(repo.index).toEqual(before.index);
    expect(repo.workdir).toEqual(before.workdir);
  });
});
