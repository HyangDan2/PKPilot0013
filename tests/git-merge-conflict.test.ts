/**
 * WO-13 · a conflicted merge is a state, not a hint.
 *
 * What this file guards:
 *  - while a conflict is unresolved, no commit can be made — not with another
 *    file staged, not with `-a`, not after a reload;
 *  - `git add` (or `git rm`) on a conflicted path is what resolves it;
 *  - the commit that concludes the merge really has two parents;
 *  - the conflict survives save / restore / abort without losing the work.
 */
import { describe, expect, it } from 'vitest';
import { GitRepo, gitSeed, type GitRepoState } from '../src/tracks/git/repo';

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

/**
 * main and feature both rewrite `app.js`, so the merge always conflicts.
 * `notes.md` is staged before the merge: the staged work must neither hide the
 * conflict nor be lost by it.
 */
const conflicted = () => {
  const repo = bootstrap({ 'app.js': 'base\n', 'notes.md': 'notes\n', 'extra.txt': 'extra\n' });
  commitAll(repo, 'base');
  repo.exec('git switch -c feature');
  repo.workdir['app.js'] = 'feature line\n';
  commitAll(repo, 'feature');
  repo.exec('git switch main');
  repo.workdir['app.js'] = 'main line\n';
  commitAll(repo, 'main');

  repo.workdir['notes.md'] = 'notes — staged\n';
  repo.exec('git add notes.md');
  repo.workdir['draft.md'] = 'draft\n';

  const merge = repo.exec('git merge feature');
  expect(merge.exit).toBe(1);
  expect(repo.mergePending).toBe('feature');
  return repo;
};

describe('WO-13 · unresolved conflicts cannot be committed past', () => {
  it('refuses a commit while a conflict is unresolved, even with other work staged', () => {
    const repo = conflicted();
    const beforeCommits = repo.snapshot().totalCommits;
    const stagedBefore = repo.snapshot().staged;

    const commit = repo.exec('git commit -m "merge"');
    expect(commit.exit).toBe(1);
    const output = text(repo, 'git status');
    expect(output).toContain('Unmerged paths:');
    expect(output).toContain('app.js');

    // nothing was recorded and the staged file is still staged
    expect(commit.lines.map((line) => line.text).join('\n')).toContain('unmerged files');
    expect(repo.snapshot().totalCommits).toBe(beforeCommits);
    expect(repo.mergePending).toBe('feature');
    expect(repo.snapshot().staged).toEqual(stagedBefore);
    expect(repo.snapshot().unmerged).toEqual(['app.js']);
  });

  it('refuses `git commit -a` without staging the conflict markers', () => {
    const repo = conflicted();
    const indexBefore = { ...repo.index };

    const commit = repo.exec('git commit -am "merge"');
    expect(commit.exit).toBe(1);
    expect(repo.index).toEqual(indexBefore);
    expect(repo.workdir['app.js']).toContain('<<<<<<< HEAD');
    expect(repo.mergePending).toBe('feature');
  });

  it('lists the conflicted file once, under Unmerged paths', () => {
    const repo = conflicted();
    const snap = repo.snapshot();
    expect(snap.unmerged).toEqual(['app.js']);
    expect(snap.unstaged.map((entry) => entry.path)).not.toContain('app.js');
    expect(text(repo, 'git status')).toContain('both modified:');
  });

  it('resolves the conflict with git add and then makes a two-parent merge commit', () => {
    const repo = conflicted();
    const mainTip = repo.branches.main as string;
    const featureTip = repo.branches.feature as string;

    repo.workdir['app.js'] = 'main line\nfeature line\n';
    expect(repo.exec('git add app.js').exit).toBe(0);
    expect(repo.snapshot().unmerged).toEqual([]);
    expect(text(repo, 'git status')).toContain('All conflicts fixed but you are still merging.');

    const commit = repo.exec('git commit -m "merge feature"');
    expect(commit.exit).toBe(0);
    expect(repo.mergePending).toBeNull();
    expect(repo.mergeState).toBeNull();

    const tip = repo.commits[repo.branches.main as string];
    expect(tip.message).toBe('merge feature');
    expect(tip.parents).toEqual([mainTip, featureTip]);
    expect(tip.tree['app.js']).toBe('main line\nfeature line\n');
    // the work that was staged before the merge is part of the merge commit
    expect(tip.tree['notes.md']).toBe('notes — staged\n');
    expect(tip.tree['draft.md']).toBeUndefined();
    expect(repo.snapshot().stats.merges).toBe(1);
    expect(repo.snapshot().untracked).toEqual(['draft.md']);
  });

  it('resolves every conflict with git add . and stages the untracked file too', () => {
    const repo = conflicted();
    repo.workdir['app.js'] = 'settled\n';
    expect(repo.exec('git add .').exit).toBe(0);
    expect(repo.snapshot().unmerged).toEqual([]);

    expect(repo.exec('git commit -m "merge"').exit).toBe(0);
    const tip = repo.commits[repo.branches.main as string];
    expect(tip.parents).toHaveLength(2);
    expect(tip.tree['app.js']).toBe('settled\n');
    // `git add .` is a whole-working-tree add: the new file goes in with it
    expect(tip.tree['draft.md']).toBe('draft\n');
  });

  it('resolves only the named conflict and keeps an untracked file out of the commit', () => {
    const repo = conflicted();
    repo.workdir['app.js'] = 'only this one\n';
    expect(repo.exec('git add app.js').exit).toBe(0);
    expect(repo.exec('git commit -m "merge"').exit).toBe(0);
    const tip = repo.commits[repo.branches.main as string];
    expect(tip.tree['draft.md']).toBeUndefined();
    expect(repo.snapshot().untracked).toEqual(['draft.md']);
  });

  it('settles a conflict as a deletion with git rm', () => {
    const repo = conflicted();
    expect(repo.exec('git rm app.js').exit).toBe(0);
    expect(repo.snapshot().unmerged).toEqual([]);
    expect(repo.exec('git commit -m "delete during merge"').exit).toBe(0);
    const tip = repo.commits[repo.branches.main as string];
    expect(tip.parents).toHaveLength(2);
    expect(tip.tree['app.js']).toBeUndefined();
  });

  it('keeps the unresolved conflict through save and restore', () => {
    const repo = conflicted();
    const saved: GitRepoState = JSON.parse(JSON.stringify(repo.serialize()));
    expect(saved.unmergedPaths).toEqual(['app.js']);

    const restored = GitRepo.fromState(saved) as GitRepo;
    expect(restored.mergePending).toBe('feature');
    expect(restored.snapshot().unmerged).toEqual(['app.js']);
    expect(restored.snapshot().mergeStateAvailable).toBe(true);
    expect(restored.exec('git commit -m "sneaky"').exit).toBe(1);

    restored.workdir['app.js'] = 'resolved after reload\n';
    restored.exec('git add app.js');
    expect(restored.exec('git commit -m "merge after reload"').exit).toBe(0);
    expect(restored.commits[restored.branches.main as string].parents).toHaveLength(2);
  });

  it('aborts back to the pre-merge state and forgets the conflict', () => {
    const repo = conflicted();
    const abort = repo.exec('git merge --abort');
    expect(abort.exit).toBe(0);
    expect(repo.mergePending).toBeNull();
    expect(repo.unmergedPaths).toEqual([]);
    expect(repo.snapshot().mergeStateAvailable).toBe(true);
    expect(repo.workdir['app.js']).toBe('main line\n');
    expect(repo.snapshot().staged).toEqual([{ path: 'notes.md', status: 'modified' }]);
    expect(repo.snapshot().untracked).toEqual(['draft.md']);
  });

  it('still refuses a second merge and a branch switch while the conflict stands', () => {
    const repo = conflicted();
    expect(repo.exec('git merge feature').exit).toBe(1);
    expect(repo.exec('git switch feature').exit).toBe(1);
    expect(repo.mergePending).toBe('feature');
    expect(repo.snapshot().unmerged).toEqual(['app.js']);
  });

  it('clears the conflict state on reset --hard', () => {
    const repo = conflicted();
    expect(repo.exec('git reset --hard HEAD').exit).toBe(0);
    expect(repo.mergePending).toBeNull();
    expect(repo.snapshot().unmerged).toEqual([]);
    expect(repo.workdir['app.js']).toBe('main line\n');
    // an untracked file is not tracked work, so a hard reset leaves it alone
    expect(repo.workdir['draft.md']).toBe('draft\n');
  });
});

describe('WO-16 · a merge restored from an older save', () => {
  /** A save written before `unmergedPaths` / `mergeState` were recorded. */
  const legacySave = () => {
    const repo = conflicted();
    const saved = JSON.parse(JSON.stringify(repo.serialize())) as Record<string, unknown>;
    delete saved.unmergedPaths;
    delete saved.mergeState;
    return { saved: saved as unknown as GitRepoState, repo };
  };

  it('recovers the unresolved paths from the conflict markers', () => {
    const { saved } = legacySave();
    const restored = GitRepo.fromState(saved) as GitRepo;
    expect(restored.mergePending).toBe('feature');
    expect(restored.snapshot().unmerged).toEqual(['app.js']);
    // no snapshot was stored: the UI is told abort cannot restore the work tree
    expect(restored.snapshot().mergeStateAvailable).toBe(false);
    expect(restored.exec('git commit -m "legacy"').exit).toBe(1);
  });

  it('warns that abort can only reach HEAD, and keeps untracked files', () => {
    const { saved } = legacySave();
    const restored = GitRepo.fromState(saved) as GitRepo;

    const abort = restored.exec('git merge --abort');
    expect(abort.exit).toBe(0);
    const output = abort.lines.map((line) => line.text).join('\n');
    expect(output).toContain('Merge aborted.');
    expect(output).toContain('복원되지 않을 수 있습니다');
    expect(restored.mergePending).toBeNull();
    expect(restored.workdir['app.js']).toBe('main line\n');
    expect(restored.workdir['draft.md']).toBe('draft\n');
  });

  it('keeps a normal clean commit working after the migration', () => {
    const { saved } = legacySave();
    const restored = GitRepo.fromState(saved) as GitRepo;
    restored.workdir['app.js'] = 'resolved\n';
    restored.exec('git add app.js');
    expect(restored.exec('git commit -m "merge"').exit).toBe(0);
    expect(restored.commits[restored.branches.main as string].parents).toHaveLength(2);
  });

  it('reads a save that has a merge but no conflict left as resolved', () => {
    const repo = bootstrap({ 'a.txt': 'a\n' });
    commitAll(repo, 'base');
    repo.workdir['a.txt'] = 'a\n';
    const saved = JSON.parse(JSON.stringify(repo.serialize())) as Record<string, unknown>;
    saved.mergePending = 'feature';
    const branches = saved.branches as Record<string, string | null>;
    saved.branches = { ...branches, feature: branches.main ?? null };
    delete saved.unmergedPaths;

    const restored = GitRepo.fromState(saved as unknown as GitRepoState) as GitRepo;
    expect(restored.snapshot().unmerged).toEqual([]);
    // nothing conflicted and nothing changed: real git still lets the merge end
    expect(restored.exec('git commit -m "conclude"').exit).toBe(0);
    expect(restored.mergePending).toBeNull();
  });
});
