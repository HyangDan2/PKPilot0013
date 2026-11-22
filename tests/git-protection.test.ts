/**
 * Second stabilisation round (v2.1.0, WO-07 … WO-10).
 *
 * The three data-safety promises this file guards:
 *  - `git merge --abort` puts back exactly what the learner had when the merge
 *    started — staged, unstaged and untracked work included.
 *  - `git rm` never deletes content that is not safely in a commit; only
 *    `-f`/`--force` may throw uncommitted work away.
 *  - a working tree with no files at all is a normal state, not a broken one.
 */
import { describe, expect, it } from 'vitest';
import { GitRepo, gitSeed, type GitRepoState } from '../src/tracks/git/repo';
import { projectGit } from '../src/state/session';

const bootstrap = (seed: Record<string, string> = gitSeed()) => {
  const repo = new GitRepo(seed);
  repo.exec('git init');
  return repo;
};

const commitAll = (repo: GitRepo, message: string) => {
  repo.exec('git add .');
  return repo.exec(`git commit -m "${message}"`);
};

const text = (repo: GitRepo, command: string) =>
  repo
    .exec(command)
    .lines.map((line) => line.text)
    .join('\n');

/** The files and status a learner can see — the part an abort must not mangle. */
const visible = (repo: GitRepo) => {
  const snap = repo.snapshot();
  return {
    workdir: { ...repo.workdir },
    index: { ...repo.index },
    staged: snap.staged,
    unstaged: snap.unstaged,
    untracked: snap.untracked,
    branch: snap.branch,
    totalCommits: snap.totalCommits,
  };
};

/**
 * main and feature both rewrite `app.js`, so merging them always conflicts —
 * the state a learner aborts from. Their other local work does not collide.
 */
const conflictWithLocalWork = () => {
  const repo = bootstrap({ 'app.js': 'base\n', 'notes.md': 'notes\n', 'extra.txt': 'extra\n' });
  commitAll(repo, 'base');
  repo.exec('git switch -c feature');
  repo.workdir['app.js'] = 'feature\n';
  commitAll(repo, 'feature');
  repo.exec('git switch main');
  repo.workdir['app.js'] = 'main\n';
  commitAll(repo, 'main');

  // Before merging: one staged edit, one unstaged edit, one untracked file.
  repo.workdir['notes.md'] = 'notes — staged\n';
  repo.exec('git add notes.md');
  repo.workdir['extra.txt'] = 'extra — unstaged\n';
  repo.workdir['draft.md'] = 'draft\n';
  const snap = repo.snapshot();
  expect(snap.staged).toEqual([{ path: 'notes.md', status: 'modified' }]);
  expect(snap.unstaged).toEqual([{ path: 'extra.txt', status: 'modified' }]);
  expect(snap.untracked).toEqual(['draft.md']);
  return repo;
};

describe('WO-07 · git merge --abort restores the pre-merge state', () => {
  it('puts back staged, unstaged and untracked work exactly as it was', () => {
    const repo = conflictWithLocalWork();
    const before = visible(repo);
    const stateBefore = repo.capture();

    const merge = repo.exec('git merge feature');
    expect(merge.exit).toBe(1);
    expect(repo.mergePending).toBe('feature');
    expect(repo.workdir['app.js']).toContain('<<<<<<< HEAD');
    // the merge changed the working tree — that is what makes the abort meaningful
    expect(repo.workdir['app.js']).not.toBe(before.workdir['app.js']);

    const abort = repo.exec('git merge --abort');
    expect(abort.exit).toBe(0);
    expect(repo.mergePending).toBeNull();
    expect(visible(repo)).toEqual(before);

    // the whole stored state comes back, not only the files on screen
    const after = repo.capture();
    expect(after.workdir).toEqual(stateBefore.workdir);
    expect(after.index).toEqual(stateBefore.index);
    expect(after.branches).toEqual(stateBefore.branches);
    expect(after.head).toEqual(stateBefore.head);
    expect(after.mergeState).toBeNull();
  });

  it('leaves the local work usable: status still lists it and it can be committed', () => {
    const repo = conflictWithLocalWork();
    repo.exec('git merge feature');
    repo.exec('git merge --abort');

    const status = text(repo, 'git status');
    expect(status).toContain('Changes to be committed:');
    expect(status).toContain('notes.md');
    expect(status).toContain('Changes not staged for commit:');
    expect(status).toContain('extra.txt');
    expect(status).toContain('Untracked files:');
    expect(status).toContain('draft.md');

    expect(repo.exec('git commit -m "after abort"').exit).toBe(0);
    expect(repo.snapshot().commits[0].message).toBe('after abort');
    expect(repo.workdir['app.js']).toBe('main\n');
  });

  it('discards edits the learner made to the conflict markers', () => {
    const repo = conflictWithLocalWork();
    repo.exec('git merge feature');
    repo.workdir['app.js'] = 'a half-resolved guess\n';
    repo.exec('git merge --abort');

    expect(repo.workdir['app.js']).toBe('main\n');
    expect(repo.workdir['draft.md']).toBe('draft\n');
  });

  it('survives a reload in the middle of a conflicted merge', () => {
    const repo = conflictWithLocalWork();
    const before = visible(repo);
    repo.exec('git merge feature');

    const saved: GitRepoState = JSON.parse(JSON.stringify(repo.serialize()));
    const reloaded = GitRepo.fromState(saved) as GitRepo;
    expect(reloaded.mergePending).toBe('feature');
    expect(reloaded.workdir['app.js']).toContain('<<<<<<< HEAD');

    const abort = reloaded.exec('git merge --abort');
    expect(abort.exit).toBe(0);
    expect(reloaded.mergePending).toBeNull();
    expect(visible(reloaded)).toEqual(before);
  });

  it('refuses to abort when no merge is in progress', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    const abort = repo.exec('git merge --abort');
    expect(abort.exit).toBe(1);
    expect(text(repo, 'git status')).toContain('nothing to commit');
  });

  it('refuses a second merge until the first one is concluded', () => {
    const repo = conflictWithLocalWork();
    repo.exec('git merge feature');
    const before = visible(repo);
    const other = repo.exec('git merge main');
    expect(other.exit).toBe(1);
    expect(other.lines.map((line) => line.text).join('\n')).toContain('You have not concluded your merge');
    expect(visible(repo)).toEqual(before);

    // the merge is still resolvable after the refusal
    repo.workdir['app.js'] = 'resolved\n';
    repo.exec('git add .');
    expect(repo.exec('git commit -m "merge"').exit).toBe(0);
    expect(repo.mergePending).toBeNull();
    expect(repo.snapshot().stats.merges).toBe(1);
  });

  it('refuses a branch switch in the middle of a merge', () => {
    const repo = conflictWithLocalWork();
    repo.exec('git merge feature');
    const before = visible(repo);
    const blocked = repo.exec('git switch feature');
    expect(blocked.exit).toBe(1);
    expect(blocked.lines.map((line) => line.text).join('\n')).toContain('resolve your current index');
    expect(repo.mergePending).toBe('feature');
    expect(visible(repo)).toEqual(before);
  });
});

describe('WO-08 · git rm protects uncommitted work', () => {
  const tracked = () => {
    const repo = bootstrap({ 'keep.txt': 'v1\n', 'other.txt': 'other\n' });
    commitAll(repo, 'base');
    return repo;
  };

  it('refuses to delete a file with unstaged modifications and keeps it', () => {
    const repo = tracked();
    repo.workdir['keep.txt'] = 'my edit\n';

    const rm = repo.exec('git rm keep.txt');
    expect(rm.exit).toBe(1);
    const output = rm.lines.map((line) => line.text).join('\n');
    expect(output).toContain('have local modifications');
    expect(output).toContain('use -f to force removal');
    expect(repo.workdir['keep.txt']).toBe('my edit\n');
    expect(repo.index['keep.txt']).toBe('v1\n');
  });

  it('refuses to delete a file whose new content is only staged', () => {
    const repo = tracked();
    repo.workdir['keep.txt'] = 'staged edit\n';
    repo.exec('git add keep.txt');

    const rm = repo.exec('git rm keep.txt');
    expect(rm.exit).toBe(1);
    expect(rm.lines.map((line) => line.text).join('\n')).toContain('staged content different');
    expect(repo.workdir['keep.txt']).toBe('staged edit\n');
    expect(repo.index['keep.txt']).toBe('staged edit\n');
  });

  it('removes a clean tracked file without asking — that content is in a commit', () => {
    const repo = tracked();
    const rm = repo.exec('git rm keep.txt');
    expect(rm.exit).toBe(0);
    expect(repo.workdir['keep.txt']).toBeUndefined();
    expect(repo.index['keep.txt']).toBeUndefined();
    expect(repo.snapshot().staged).toEqual([{ path: 'keep.txt', status: 'deleted' }]);
  });

  it('deletes anyway with -f or --force', () => {
    for (const flag of ['-f', '--force']) {
      const repo = tracked();
      repo.workdir['keep.txt'] = 'my edit\n';
      const rm = repo.exec(`git rm ${flag} keep.txt`);
      expect(rm.exit).toBe(0);
      expect(repo.workdir['keep.txt']).toBeUndefined();
      expect(repo.index['keep.txt']).toBeUndefined();
    }
  });

  it('is all or nothing across several paths', () => {
    const repo = tracked();
    repo.workdir['other.txt'] = 'edited\n';
    const before = { workdir: { ...repo.workdir }, index: { ...repo.index } };

    const rm = repo.exec('git rm keep.txt other.txt');
    expect(rm.exit).toBe(1);
    expect(repo.workdir).toEqual(before.workdir);
    expect(repo.index).toEqual(before.index);
  });

  it('still refuses an unknown pathspec and changes nothing', () => {
    const repo = tracked();
    const rm = repo.exec('git rm keep.txt nope.txt');
    expect(rm.exit).toBe(1);
    expect(repo.workdir['keep.txt']).toBe('v1\n');
    expect(repo.index['keep.txt']).toBe('v1\n');
  });

  it('with --cached, refuses to drop the index entry of uncommitted content', () => {
    const repo = tracked();
    repo.workdir['keep.txt'] = 'edited\n';
    const refused = repo.exec('git rm --cached keep.txt');
    expect(refused.exit).toBe(1);
    expect(repo.index['keep.txt']).toBe('v1\n');
    expect(repo.workdir['keep.txt']).toBe('edited\n');

    const forced = repo.exec('git rm --cached -f keep.txt');
    expect(forced.exit).toBe(0);
    expect(repo.index['keep.txt']).toBeUndefined();
    // the file itself stays on disk, as `--cached` promises
    expect(repo.workdir['keep.txt']).toBe('edited\n');
    expect(repo.snapshot().staged).toEqual([{ path: 'keep.txt', status: 'deleted' }]);
  });
});

describe('WO-09 · no command silently loses a local file', () => {
  const scenario = () => {
    const repo = bootstrap({ 'app.js': 'base\n', 'notes.md': 'notes\n', 'extra.txt': 'extra\n' });
    commitAll(repo, 'base');
    repo.exec('git switch -c feature');
    repo.workdir['app.js'] = 'feature\n';
    commitAll(repo, 'feature');
    repo.exec('git switch main');
    repo.workdir['app.js'] = 'main\n';
    commitAll(repo, 'main');

    // Uncommitted work in three shapes: staged, unstaged and untracked.
    repo.workdir['notes.md'] = 'notes — staged\n';
    repo.exec('git add notes.md');
    repo.workdir['extra.txt'] = 'extra — unstaged\n';
    repo.workdir['draft.md'] = 'draft\n';
    return repo;
  };

  const localWork = { 'notes.md': 'notes — staged\n', 'extra.txt': 'extra — unstaged\n', 'draft.md': 'draft\n' };

  const commands = [
    'git switch feature',
    'git checkout feature',
    'git merge feature',
    'git rebase feature',
    'git reset --hard HEAD',
    'git reset --hard nope',
    'git restore notes.md missing.md',
    'git rm notes.md',
    'git rm -f app.js missing.md',
    'git cherry-pick nope',
  ];

  for (const command of commands) {
    it(`'${command}' loses no file at all`, () => {
      const repo = scenario();
      const paths = Object.keys(repo.workdir).sort();
      repo.exec(command);

      // No command in this list may make a file disappear from the disk.
      expect(Object.keys(repo.workdir).sort(), `${command} changed the file set`).toEqual(paths);

      if (command === 'git reset --hard HEAD') {
        // the one documented exception: tracked edits go back to the commit
        expect(repo.workdir['notes.md']).toBe('notes\n');
        expect(repo.workdir['extra.txt']).toBe('extra\n');
        expect(repo.workdir['draft.md']).toBe('draft\n');
        return;
      }
      for (const [path, content] of Object.entries(localWork)) {
        expect(repo.workdir[path], `${command} lost ${path}`).toBe(content);
      }
    });
  }
});

describe('WO-10 · a working tree with no files', () => {
  it('supports an empty working tree and rebuilds it file by file', () => {
    const repo = bootstrap({ 'only.txt': 'first\n' });
    commitAll(repo, 'base');

    expect(repo.exec('git rm only.txt').exit).toBe(0);
    expect(repo.workdir).toEqual({});
    expect(repo.index).toEqual({});
    expect(repo.untrackedFiles()).toEqual([]);
    expect(repo.snapshot().staged).toEqual([{ path: 'only.txt', status: 'deleted' }]);

    const status = repo.exec('git status');
    expect(status.exit).toBe(0);
    expect(status.lines.map((line) => line.text).join('\n')).toContain('Changes to be committed');

    // committing the deletion is the state "this repository holds no files"
    expect(repo.exec('git commit -m "empty"').exit).toBe(0);
    expect(repo.headTree()).toEqual({});
    expect(repo.snapshot().staged).toEqual([]);
    expect(repo.snapshot().unstaged).toEqual([]);
    expect(repo.snapshot().untracked).toEqual([]);

    // and a new file works from there
    repo.workdir['new.md'] = 'again\n';
    expect(repo.snapshot().untracked).toEqual(['new.md']);
    repo.exec('git add .');
    expect(repo.exec('git commit -m "new file"').exit).toBe(0);
    expect(repo.snapshot().staged).toEqual([]);
    expect(repo.snapshot().commits[0].message).toBe('new file');
  });

  it('round-trips an empty working tree through save and restore', () => {
    const repo = bootstrap({ 'only.txt': 'first\n' });
    commitAll(repo, 'base');
    repo.exec('git rm only.txt');
    repo.exec('git commit -m "empty"');

    const restored = GitRepo.fromState(JSON.parse(JSON.stringify(repo.serialize()))) as GitRepo;
    expect(restored.workdir).toEqual({});
    expect(restored.snapshot()).toEqual(repo.snapshot());
    expect(restored.exec('git status').exit).toBe(0);
    expect(restored.snapshot().totalCommits).toBe(2);
  });

  it('opens nothing in the editor instead of a path that does not exist', () => {
    const repo = new GitRepo({});
    expect(projectGit(repo, 'README.md')).toEqual({ files: {}, active: '' });
    expect(projectGit(repo, '')).toEqual({ files: {}, active: '' });

    repo.workdir['a.md'] = 'a\n';
    expect(projectGit(repo, '')).toEqual({ files: { 'a.md': 'a\n' }, active: 'a.md' });
  });
});
