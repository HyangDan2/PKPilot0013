/**
 * Regression tests for the Git engine's state guarantees (WO-01, WO-02, WO-05):
 * working-tree/index consistency, no silent loss of local changes, atomic
 * rollback when a command fails, and the command details a beginner types.
 */
import { describe, expect, it } from 'vitest';
import { GitRepo, gitSeed, type GitRepoState } from '../src/tracks/git/repo';
import { evaluateCheck } from '../src/lessons/checks';
import { gitFields } from '../src/lessons/state';
import { lessonById } from '../src/lessons';
import type { Lesson, LessonState } from '../src/lessons/types';

const bootstrap = (seed: Record<string, string> = gitSeed()) => {
  const repo = new GitRepo(seed);
  repo.exec('git init');
  return repo;
};

const commitAll = (repo: GitRepo, message: string) => {
  repo.exec('git add .');
  return repo.exec(`git commit -m "${message}"`);
};

describe('WO-05 · git add -A / -u and pathspec errors', () => {
  it('accepts git add -A and stages new, modified and deleted files', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.workdir['new.txt'] = 'new\n';
    repo.workdir['app.js'] = 'changed\n';
    delete repo.workdir['styles.css'];

    const add = repo.exec('git add -A');
    expect(add.exit).toBe(0);
    expect(repo.index['new.txt']).toBe('new\n');
    expect(repo.index['app.js']).toBe('changed\n');
    expect(repo.index['styles.css']).toBeUndefined();

    const snap = repo.snapshot();
    expect(snap.staged.map((entry) => `${entry.status}:${entry.path}`).sort()).toEqual([
      'added:new.txt',
      'deleted:styles.css',
      'modified:app.js',
    ]);
  });

  it('accepts --all and stages only tracked files for -u', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.workdir['untracked.txt'] = 'u\n';
    repo.workdir['app.js'] = 'changed\n';

    expect(repo.exec('git add --all').exit).toBe(0);
    expect(repo.index['untracked.txt']).toBe('u\n');

    const update = bootstrap();
    commitAll(update, 'base');
    update.workdir['untracked.txt'] = 'u\n';
    update.workdir['app.js'] = 'changed\n';
    expect(update.exec('git add -u').exit).toBe(0);
    expect(update.index['untracked.txt']).toBeUndefined();
    expect(update.index['app.js']).toBe('changed\n');
    expect(update.untrackedFiles()).toEqual(['untracked.txt']);
  });

  it('leaves the index untouched when one pathspec does not match', () => {
    const repo = bootstrap();
    const before = { ...repo.index };
    const add = repo.exec('git add README.md nope.txt');
    expect(add.exit).toBe(1);
    expect(add.lines.map((line) => line.text).join(' ')).toContain("pathspec 'nope.txt' did not match any files");
    expect(repo.index).toEqual(before);
  });
});

describe('WO-05 · git commit -am', () => {
  it('stages tracked changes only and never swallows untracked files', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');

    repo.workdir['app.js'] = 'tracked change\n';
    repo.workdir['scratch.txt'] = 'untracked\n';
    const commit = repo.exec('git commit -am "tracked only"');
    expect(commit.exit).toBe(0);

    const tree = repo.snapshot().commits[0].sha;
    expect(repo.commits[tree].tree['app.js']).toBe('tracked change\n');
    expect(repo.commits[tree].tree['scratch.txt']).toBeUndefined();
    expect(repo.untrackedFiles()).toEqual(['scratch.txt']);
  });

  it('understands -am with the message attached and separated short flags', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.workdir['app.js'] = 'one\n';
    expect(repo.exec('git commit -am"attached"').exit).toBe(0);
    expect(repo.snapshot().commits[0].message).toBe('attached');

    repo.workdir['app.js'] = 'two\n';
    expect(repo.exec('git commit -a -m "separate"').exit).toBe(0);
    expect(repo.snapshot().commits[0].message).toBe('separate');
  });

  it('does not stage anything when the commit itself is rejected', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.workdir['app.js'] = 'dirty\n';
    const before = { ...repo.index };
    const empty = repo.exec('git commit -am ""');
    expect(empty.exit).toBe(1);
    expect(repo.index).toEqual(before);
  });
});

describe('WO-05 · git reset --hard keeps untracked files', () => {
  it('restores tracked files, drops staged ones and leaves untracked files alone', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    const base = repo.branches.main as string;

    repo.workdir['tracked.txt'] = 'tracked v2\n';
    commitAll(repo, 'later');
    repo.workdir['scratch.txt'] = 'mine\n';
    repo.workdir['app.js'] = 'edited\n';

    const reset = repo.exec('git reset --hard HEAD~1');
    expect(reset.exit).toBe(0);
    expect(repo.branches.main).toBe(base);
    expect(repo.workdir['tracked.txt']).toBeUndefined();
    expect(repo.workdir['app.js']).toBe(repo.commits[base].tree['app.js']);
    expect(repo.workdir['scratch.txt']).toBe('mine\n');
    expect(repo.untrackedFiles()).toEqual(['scratch.txt']);
  });
});

describe('WO-02 · checkout/switch keeps local work and refuses to overwrite it', () => {
  const twoBranches = () => {
    const repo = bootstrap();
    repo.workdir['app.js'] = 'base\n';
    repo.workdir['shared.txt'] = 'shared base\n';
    commitAll(repo, 'base');
    repo.exec('git switch -c feature');
    repo.workdir['app.js'] = 'feature\n';
    commitAll(repo, 'feature line');
    repo.exec('git switch main');
    return repo;
  };

  it('carries a staged change that does not conflict with the target branch', () => {
    const repo = twoBranches();
    repo.workdir['notes.md'] = 'staged note\n';
    repo.exec('git add notes.md');

    const switchBack = repo.exec('git switch feature');
    expect(switchBack.exit).toBe(0);
    expect(repo.branch).toBe('feature');
    expect(repo.workdir['notes.md']).toBe('staged note\n');
    expect(repo.index['notes.md']).toBe('staged note\n');
    expect(repo.snapshot().staged).toEqual([{ path: 'notes.md', status: 'added' }]);
  });

  it('carries unstaged and untracked work across a switch and says so', () => {
    const repo = twoBranches();
    repo.workdir['shared.txt'] = 'shared edited\n';
    repo.workdir['draft.md'] = 'draft\n';

    const switched = repo.exec('git switch feature');
    expect(switched.exit).toBe(0);
    expect(repo.workdir['shared.txt']).toBe('shared edited\n');
    expect(repo.workdir['draft.md']).toBe('draft\n');
    expect(switched.lines.map((line) => line.text).join('\n')).toContain('shared.txt');
  });

  it('creates a branch without dropping staged work', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.workdir['app.js'] = 'staged\n';
    repo.exec('git add app.js');

    expect(repo.exec('git switch -c wip').exit).toBe(0);
    expect(repo.branch).toBe('wip');
    expect(repo.index['app.js']).toBe('staged\n');
    expect(repo.workdir['app.js']).toBe('staged\n');
    expect(repo.snapshot().staged).toEqual([{ path: 'app.js', status: 'modified' }]);
  });

  it('refuses a switch that would overwrite a local change and changes nothing', () => {
    const repo = twoBranches();
    repo.workdir['app.js'] = 'dirty\n';
    const before = repo.snapshot();

    const blocked = repo.exec('git switch feature');
    expect(blocked.exit).toBe(1);
    expect(blocked.lines.map((line) => line.text).join('\n')).toContain('would be overwritten by checkout');
    expect(repo.branch).toBe('main');
    expect(repo.workdir['app.js']).toBe('dirty\n');
    expect(repo.snapshot().unstaged).toEqual(before.unstaged);
    expect(repo.snapshot().totalCommits).toBe(before.totalCommits);
  });

  it('refuses to overwrite an untracked file that exists on the target branch', () => {
    const repo = twoBranches();
    repo.workdir['feature-only.txt'] = 'feature file\n';
    commitAll(repo, 'feature file');
    repo.exec('git switch main');
    repo.workdir['feature-only.txt'] = 'my own copy\n';

    const blocked = repo.exec('git switch feature');
    expect(blocked.exit).toBe(1);
    expect(repo.branch).toBe('main');
    expect(repo.workdir['feature-only.txt']).toBe('my own copy\n');
  });

  it('discards local changes only when the learner forces it', () => {
    const repo = twoBranches();
    repo.workdir['app.js'] = 'dirty\n';
    expect(repo.exec('git switch feature').exit).toBe(1);

    const forced = repo.exec('git switch -f feature');
    expect(forced.exit).toBe(0);
    expect(repo.branch).toBe('feature');
    expect(repo.workdir['app.js']).toBe('feature\n');
    expect(repo.snapshot().unstaged).toEqual([]);
  });

  it('keeps a deleted file deleted across a switch when the target matches HEAD', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    delete repo.workdir['styles.css'];
    expect(repo.exec('git switch -c trimmed').exit).toBe(0);
    expect(repo.workdir['styles.css']).toBeUndefined();
    expect(repo.snapshot().unstaged).toEqual([{ path: 'styles.css', status: 'deleted' }]);
  });
});

describe('WO-02 · merge protects local changes', () => {
  it('refuses a merge that would overwrite a local edit, and changes nothing', () => {
    const repo = bootstrap();
    repo.workdir['app.js'] = 'base\n';
    commitAll(repo, 'base');
    repo.exec('git switch -c feature');
    repo.workdir['app.js'] = 'feature\n';
    commitAll(repo, 'feature');
    repo.exec('git switch main');

    repo.workdir['app.js'] = 'local edit\n';
    const before = repo.snapshot();
    const merge = repo.exec('git merge feature');
    expect(merge.exit).toBe(1);
    expect(merge.lines.map((line) => line.text).join('\n')).toContain('would be overwritten by merge');
    expect(repo.branch).toBe('main');
    expect(repo.workdir['app.js']).toBe('local edit\n');
    expect(repo.mergePending).toBeNull();
    expect(repo.snapshot().totalCommits).toBe(before.totalCommits);
  });

  it('aborts a conflicted merge back to the pre-merge state', () => {
    const repo = bootstrap();
    repo.workdir['app.js'] = 'base\n';
    commitAll(repo, 'base');
    repo.exec('git switch -c feature');
    repo.workdir['app.js'] = 'feature\n';
    commitAll(repo, 'feature');
    repo.exec('git switch main');
    repo.workdir['app.js'] = 'main\n';
    commitAll(repo, 'main');

    expect(repo.exec('git merge feature').exit).toBe(1);
    expect(repo.mergePending).toBe('feature');
    const abort = repo.exec('git merge --abort');
    expect(abort.exit).toBe(0);
    expect(repo.mergePending).toBeNull();
    expect(repo.workdir['app.js']).toBe('main\n');
    expect(repo.snapshot().unstaged).toEqual([]);
  });
});

describe('WO-02 · rebase rolls back completely', () => {
  it('leaves no temporary commits or stats behind when a replay conflicts', () => {
    const repo = bootstrap();
    repo.workdir['app.js'] = 'base\n';
    repo.workdir['other.txt'] = 'other\n';
    commitAll(repo, 'base');

    repo.exec('git switch -c topic');
    repo.workdir['app.js'] = 'topic one\n';
    commitAll(repo, 'topic one');
    repo.workdir['app.js'] = 'topic two\n';
    commitAll(repo, 'topic two');

    repo.exec('git switch main');
    repo.workdir['app.js'] = 'main change\n';
    commitAll(repo, 'main change');

    repo.exec('git switch topic');
    const before = repo.snapshot();
    const epic = { ...repo.commits };
    const rebase = repo.exec('git rebase main');
    expect(rebase.exit).toBe(1);
    expect(rebase.lines.map((line) => line.text).join('\n')).toContain('CONFLICT');

    const after = repo.snapshot();
    expect(after.totalCommits).toBe(before.totalCommits);
    expect(Object.keys(repo.commits).sort()).toEqual(Object.keys(epic).sort());
    expect(after.stats.rebases).toBe(before.stats.rebases);
    expect(after.stats.commits).toBe(before.stats.commits);
    expect(repo.branches.topic).toBe(before.branches.find((branch) => branch.current)?.sha);
    expect(repo.workdir['app.js']).toBe('topic two\n');
    expect(repo.snapshot().unstaged).toEqual([]);
  });

  it('refuses to rebase over uncommitted work', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.exec('git switch -c topic');
    repo.workdir['t.txt'] = 't\n';
    commitAll(repo, 'topic');
    repo.exec('git switch main');
    repo.workdir['m.txt'] = 'm\n';
    commitAll(repo, 'main');
    repo.exec('git switch topic');
    repo.workdir['app.js'] = 'dirty\n';

    const rebase = repo.exec('git rebase main');
    expect(rebase.exit).toBe(1);
    expect(rebase.lines.map((line) => line.text).join('\n')).toContain('unstaged changes');
    expect(repo.workdir['app.js']).toBe('dirty\n');
  });
});

describe('WO-01 · state capture, restore and persistence', () => {
  it('round-trips the whole repository through a serialisable state', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.exec('git switch -c feature');
    repo.workdir['feature.txt'] = 'x\n';
    commitAll(repo, 'feature');
    repo.exec('git switch main');
    repo.workdir['dirty.txt'] = 'work in progress\n';
    repo.exec('git add dirty.txt');

    const saved: GitRepoState = JSON.parse(JSON.stringify(repo.serialize()));
    const restored = GitRepo.fromState(saved) as GitRepo;
    expect(restored).not.toBeNull();

    expect(restored.branch).toBe('main');
    expect(restored.snapshot()).toEqual(repo.snapshot());
    expect(restored.workdir).toEqual(repo.workdir);
    expect(restored.index).toEqual(repo.index);
    // and it keeps working after the round trip
    expect(restored.exec('git commit -m "restored"').exit).toBe(0);
    expect(restored.snapshot().totalCommits).toBe(3);
  });

  it('rejects a corrupt saved state instead of booting a broken repo', () => {
    expect(GitRepo.fromState(null)).toBeNull();
    expect(GitRepo.fromState({ version: 1 } as unknown as GitRepoState)).toBeNull();
    expect(GitRepo.fromState({ ...bootstrap().serialize(), head: { kind: 'branch' } } as unknown as GitRepoState)).toBeNull();
  });

  it('restores a conflicted merge so a reload does not lose the conflict', () => {
    const repo = bootstrap();
    repo.workdir['app.js'] = 'base\n';
    commitAll(repo, 'base');
    repo.exec('git switch -c feature');
    repo.workdir['app.js'] = 'feature\n';
    commitAll(repo, 'feature');
    repo.exec('git switch main');
    repo.workdir['app.js'] = 'main\n';
    commitAll(repo, 'main');
    repo.exec('git merge feature');

    const restored = GitRepo.fromState(JSON.parse(JSON.stringify(repo.serialize()))) as GitRepo;
    expect(restored.mergePending).toBe('feature');
    expect(restored.workdir['app.js']).toContain('<<<<<<< HEAD');
  });
});

describe('WO-05 · branch mission is tied to the branch’s own history', () => {
  const lesson = lessonById('git-basics') as Lesson;
  const state = (repo: GitRepo): LessonState => ({
    runtime: 'git',
    files: { ...lesson.files },
    active: lesson.entry,
    runs: 0,
    stdout: '',
    stderr: '',
    history: [],
    lastCommand: '',
    ...gitFields(repo.snapshot()),
  });
  const branchCheck = lesson.missions.find((mission) => mission.id === 'git-branch')!.check;

  it('needs a commit that main does not have', () => {
    const repo = new GitRepo({ ...lesson.files });
    repo.exec('git init');
    commitAll(repo, 'base');
    repo.exec('git switch -c feature');
    expect(evaluateCheck(branchCheck, state(repo))).toBe(false);

    repo.workdir['feature.txt'] = 'one\n';
    commitAll(repo, 'feature work');
    expect(evaluateCheck(branchCheck, state(repo))).toBe(true);
  });

  it('does not accept a branch created from an older commit', () => {
    const repo = new GitRepo({ ...lesson.files });
    repo.exec('git init');
    commitAll(repo, 'base');
    repo.workdir['second.txt'] = 'two\n';
    commitAll(repo, 'second');
    repo.exec('git branch legacy HEAD~1');
    expect(evaluateCheck(branchCheck, state(repo))).toBe(false);
  });
});

describe('WO-02 · failed commands leave the repository untouched', () => {
  it('does not partially remove files for git rm', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    const before = { ...repo.index, ...repo.workdir };
    const rm = repo.exec('git rm README.md missing.txt');
    expect(rm.exit).toBe(1);
    expect(repo.index).toEqual(expect.objectContaining({ 'README.md': before['README.md'] }));
    expect(repo.workdir['README.md']).toBe(before['README.md']);
  });

  it('does not partially restore files for git restore', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.workdir['README.md'] = 'dirty\n';
    const restore = repo.exec('git restore README.md nope.md');
    expect(restore.exit).toBe(1);
    expect(repo.workdir['README.md']).toBe('dirty\n');
  });

  it('keeps HEAD, index and workdir on an unknown reset target', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.workdir['app.js'] = 'dirty\n';
    const before = repo.snapshot();
    const reset = repo.exec('git reset --hard nope');
    expect(reset.exit).toBe(1);
    expect(repo.workdir['app.js']).toBe('dirty\n');
    expect(repo.snapshot().head).toEqual(before.head);
  });
});
