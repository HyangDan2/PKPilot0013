/**
 * WO-18 · the remote half of the Git lesson: `git remote`, `git push`,
 * `git fetch` and `git pull` against the in-page virtual origin.
 *
 * The remote is a set of refs held by the repository object, so every case here
 * is about behaviour a learner will actually see: what `git status` says after a
 * push, what a rejected push explains, and what `pull` does with the difference.
 */
import { describe, expect, it } from 'vitest';
import { GitRepo, gitSeed, type GitRepoState } from '../src/tracks/git/repo';

const REMOTE = 'https://github.com/learner/playground.git';

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

/** init → first commit → origin added — the state the push lesson starts from. */
const published = () => {
  const repo = bootstrap();
  commitAll(repo, '첫 커밋');
  repo.exec(`git remote add origin ${REMOTE}`);
  return repo;
};

describe('git remote', () => {
  it('adds, lists and shows a remote, and refuses a duplicate name', () => {
    const repo = bootstrap();
    expect(repo.exec('git remote').lines).toEqual([]);

    expect(repo.exec(`git remote add origin ${REMOTE}`).exit).toBe(0);
    expect(repo.exec('git remote add upstream https://github.com/learner/upstream.git').exit).toBe(0);
    expect(repo.snapshot().remotes.map((remote) => remote.name)).toEqual(['origin', 'upstream']);

    const listed = text(repo, 'git remote -v');
    expect(listed).toContain(`origin\t${REMOTE} (fetch)`);
    expect(listed).toContain(`origin\t${REMOTE} (push)`);

    const duplicate = repo.exec(`git remote add origin ${REMOTE}`);
    expect(duplicate.exit).toBe(1);
    expect(duplicate.lines[0].text).toContain('remote origin already exists');

    const missingUrl = repo.exec('git remote add backup');
    expect(missingUrl.exit).toBe(1);
    expect(missingUrl.lines[0].text).toContain('usage: git remote add');
  });

  it('removes a remote together with the branches it owned and the upstreams pointing at it', () => {
    const repo = published();
    repo.exec(`git push -u origin main`);
    expect(repo.snapshot().upstream?.ref).toBe('origin/main');

    expect(repo.exec('git remote remove origin').exit).toBe(0);
    const snap = repo.snapshot();
    expect(snap.remotes).toEqual([]);
    expect(snap.remoteBranches).toEqual([]);
    expect(snap.upstream).toBeNull();
    // the commits and the branch itself are untouched
    expect(snap.totalCommits).toBe(1);
    expect(snap.branch).toBe('main');

    const unknown = repo.exec('git remote remove nope');
    expect(unknown.exit).toBe(1);
    expect(unknown.lines[0].text).toContain("No such remote: 'nope'");
  });
});

describe('git push', () => {
  it('pushes a branch with -u and reports the tracking state in status and branch -vv', () => {
    const repo = published();
    const push = repo.exec('git push -u origin main');
    expect(push.exit).toBe(0);
    const output = push.lines.map((line) => line.text).join('\n');
    expect(output).toContain(`branch 'main' set up to track 'origin/main'.`);
    expect(output).toContain(`To ${REMOTE}`);
    expect(output).toContain('* [new branch]      main -> main');

    const snap = repo.snapshot();
    expect(snap.remoteBranches).toEqual([
      { ref: 'origin/main', remote: 'origin', branch: 'main', sha: snap.branches.find((b) => b.name === 'main')?.sha },
    ]);
    expect(snap.upstream).toMatchObject({ ref: 'origin/main', ahead: 0, behind: 0 });

    expect(text(repo, 'git status')).toContain("Your branch is up to date with 'origin/main'.");
    expect(text(repo, 'git log --oneline')).toContain('origin/main');
    expect(text(repo, 'git branch -vv')).toContain('[origin/main]');
  });

  it('says Everything up-to-date when the remote already has this commit', () => {
    const repo = published();
    repo.exec('git push -u origin main');
    const again = repo.exec('git push');
    expect(again.exit).toBe(0);
    expect(again.lines.map((line) => line.text)).toContain('Everything up-to-date');
  });

  it('explains how to set an upstream when the branch has none', () => {
    const repo = published();
    const push = repo.exec('git push');
    expect(push.exit).toBe(1);
    const output = push.lines.map((line) => line.text).join('\n');
    expect(output).toContain('fatal: The current branch main has no upstream branch.');
    expect(output).toContain('git push --set-upstream origin main');
  });

  it('refuses to push without a configured remote', () => {
    const repo = bootstrap();
    commitAll(repo, '첫 커밋');
    const bare = repo.exec('git push');
    expect(bare.exit).toBe(1);
    expect(bare.lines[0].text).toContain('No configured push destination');

    const unknown = repo.exec('git push -u origin main');
    expect(unknown.exit).toBe(1);
    expect(unknown.lines[0].text).toContain("fatal: 'origin' does not appear to be a git repository");
    expect(unknown.lines[1].text).toContain('Could not read from remote repository');
  });

  it('reports ahead-of-upstream after a new commit, then pushes it', () => {
    const repo = published();
    repo.exec('git push -u origin main');
    repo.workdir['notes.md'] = `${repo.workdir['notes.md']}\n- 푸시 뒤 커밋`;
    commitAll(repo, '푸시 뒤 커밋');

    const status = textoStatus(repo);
    expect(status).toContain("Your branch is ahead of 'origin/main' by 1 commit.");
    expect(status).toContain('(use "git push" to publish your local commits)');
    expect(repo.snapshot().upstream).toMatchObject({ ahead: 1, behind: 0 });

    const push = repo.exec('git push');
    expect(push.exit).toBe(0);
    expect(push.lines.map((line) => line.text).join('\n')).toMatch(/ {3}[0-9a-f]{7}\.\.[0-9a-f]{7} {2}main -> main/);
    expect(repo.snapshot().upstream).toMatchObject({ ahead: 0, behind: 0 });
  });

  it('rejects a non-fast-forward push, explains it, and leaves the repository as it was', () => {
    const repo = published();
    repo.exec('git push -u origin main');
    // A second branch goes to the remote's main, so the remote now has work this
    // local main does not — exactly the state a teammate's push would create.
    repo.exec('git switch -c docs');
    repo.workdir['docs.md'] = 'docs\n';
    commitAll(repo, '문서 추가');
    expect(repo.exec('git push origin docs:main').exit).toBe(0);
    repo.exec('git switch main');

    const before = JSON.stringify(repo.serialize());
    const rejected = repo.exec('git push origin main');
    expect(rejected.exit).toBe(1);
    const output = rejected.lines.map((line) => line.text).join('\n');
    expect(output).toContain('! [rejected]        main -> main (non-fast-forward)');
    expect(output).toContain("error: failed to push some refs to '");
    expect(output).toContain('git pull origin main');
    expect(JSON.stringify(repo.serialize())).toBe(before);
    expect(textoStatus(repo)).toContain("Your branch is behind 'origin/main' by 1 commit");
  });

  it('pulls the remote work and then accepts the push', () => {
    const repo = published();
    repo.exec('git push -u origin main');
    repo.exec('git switch -c docs');
    repo.workdir['docs.md'] = 'docs\n';
    commitAll(repo, '문서 추가');
    repo.exec('git push origin docs:main');
    repo.exec('git switch main');

    const pull = repo.exec('git pull');
    expect(pull.exit).toBe(0);
    const output = pull.lines.map((line) => line.text).join('\n');
    expect(output).toContain(`From ${REMOTE}`);
    expect(output).toContain('Fast-forward');
    expect(repo.workdir['docs.md']).toBe('docs\n');
    expect(repo.snapshot().upstream).toMatchObject({ ahead: 0, behind: 0 });

    const push = repo.exec('git push');
    expect(push.exit).toBe(0);
    expect(push.lines.map((line) => line.text)).toContain('Everything up-to-date');
  });

  it('force-pushes over a diverged remote when the learner asks for it', () => {
    const repo = published();
    repo.exec('git push -u origin main');
    repo.exec('git switch -c docs');
    repo.workdir['docs.md'] = 'docs\n';
    commitAll(repo, '문서 추가');
    repo.exec('git push origin docs:main');
    repo.exec('git switch main');
    repo.workdir['README.md'] = `${repo.workdir['README.md']}\n내 쪽 변경`;
    commitAll(repo, '내 변경');

    const forced = repo.exec('git push --force origin main');
    expect(forced.exit).toBe(0);
    const output = forced.lines.map((line) => line.text).join('\n');
    expect(output).toContain('(forced update)');
    expect(repo.snapshot().remoteBranches[0].sha).toBe(repo.branches.main);
  });

  it('deletes a remote branch, by flag and by empty refspec', () => {
    const repo = published();
    repo.exec('git push -u origin main');
    repo.exec('git switch -c docs');
    repo.workdir['docs.md'] = 'docs\n';
    commitAll(repo, '문서 추가');
    repo.exec('git push -u origin docs');

    const del = repo.exec('git push origin --delete docs');
    expect(del.exit).toBe(0);
    expect(del.lines.map((line) => line.text).join('\n')).toContain('- [deleted]         docs');
    expect(repo.snapshot().remoteBranches.map((branch) => branch.ref)).toEqual(['origin/main']);

    const gone = repo.exec('git push origin --delete docs');
    expect(gone.exit).toBe(1);
    expect(gone.lines[0].text).toContain('remote ref does not exist');
  });

  it('pushes every branch with --all', () => {
    const repo = published();
    repo.exec('git switch -c docs');
    repo.workdir['docs.md'] = 'docs\n';
    commitAll(repo, '문서 추가');

    const all = repo.exec('git push --all origin');
    expect(all.exit).toBe(0);
    expect(repo.snapshot().remoteBranches.map((branch) => branch.ref)).toEqual(['origin/docs', 'origin/main']);
  });

  it('changes a remote URL without touching the refs', () => {
    const repo = published();
    repo.exec('git push -u origin main');
    expect(repo.exec('git remote set-url origin https://github.com/learner/moved.git').exit).toBe(0);
    const snap = repo.snapshot();
    expect(snap.remotes).toEqual([{ name: 'origin', url: 'https://github.com/learner/moved.git' }]);
    expect(snap.remoteBranches.map((branch) => branch.ref)).toEqual(['origin/main']);
    expect(text(repo, 'git remote -v')).toContain('https://github.com/learner/moved.git');
  });

  it('rejects a refspec that names no commit, and a push from a detached HEAD', () => {
    const repo = published();
    const empty = repo.exec('git push origin feature');
    expect(empty.exit).toBe(1);
    expect(empty.lines[0].text).toContain('src refspec feature does not match any');

    const sha = repo.branches.main as string;
    repo.exec('git switch --detach ' + sha.slice(0, 7));
    const detached = repo.exec('git push');
    expect(detached.exit).toBe(1);
    expect(detached.lines[0].text).toContain('not currently on a branch');
  });
});

describe('git fetch', () => {
  it('lists the remote-tracking branches and refuses when there is no remote', () => {
    const repo = bootstrap();
    commitAll(repo, '첫 커밋');
    expect(repo.exec('git fetch').exit).toBe(1);
    expect(repo.exec('git fetch').lines[0].text).toContain('No remote repository specified');

    repo.exec(`git remote add origin ${REMOTE}`);
    expect(repo.exec('git fetch').lines.map((line) => line.text).join('\n')).toContain('아직 올라온 브랜치가 없습니다');

    repo.exec('git push -u origin main');
    const fetched = repo.exec('git fetch');
    expect(fetched.exit).toBe(0);
    expect(fetched.lines.map((line) => line.text).join('\n')).toContain('origin/main');
  });

  it('finds a remote branch by name and reports an unknown one', () => {
    const repo = published();
    repo.exec('git push -u origin main');
    const one = repo.exec('git fetch origin main');
    expect(one.exit).toBe(0);
    expect(one.lines.map((line) => line.text).join('\n')).toContain('-> FETCH_HEAD');

    const missing = repo.exec('git fetch origin nope');
    expect(missing.exit).toBe(1);
    expect(missing.lines[0].text).toContain("couldn't find remote ref nope");
  });
});

describe('git pull', () => {
  it('explains the missing tracking information instead of guessing', () => {
    const repo = published();
    repo.exec('git push -u origin main');
    repo.exec('git switch -c topic');
    const pull = repo.exec('git pull');
    expect(pull.exit).toBe(1);
    expect(pull.lines[0].text).toContain('There is no tracking information for the current branch.');
  });

  it('reports an unknown remote branch', () => {
    const repo = published();
    const pull = repo.exec('git pull origin main');
    expect(pull.exit).toBe(1);
    expect(pull.lines[0].text).toContain("couldn't find remote ref main");
  });

  it('keeps a conflicted pull pending, and the merge commit concludes it', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.exec(`git remote add origin ${REMOTE}`);
    repo.exec('git push -u origin main');

    // The remote branch edits app.js one way, the local branch another.
    repo.exec('git switch -c docs');
    repo.workdir['app.js'] = 'remote side\n';
    commitAll(repo, 'remote 쪽 수정');
    repo.exec('git push origin docs:main');
    repo.exec('git switch main');
    repo.workdir['app.js'] = 'local side\n';
    commitAll(repo, 'local 쪽 수정');

    const pull = repo.exec('git pull');
    expect(pull.exit).toBe(1);
    expect(pull.lines.map((line) => line.text).join('\n')).toContain('CONFLICT (content): Merge conflict in app.js');
    expect(repo.mergePending).toBe('origin/main');
    expect(repo.snapshot().unmerged).toEqual(['app.js']);
    // an unresolved conflict still blocks the commit
    expect(repo.exec('git commit -m "merge"').exit).toBe(1);

    repo.workdir['app.js'] = 'resolved\n';
    repo.exec('git add app.js');
    const commit = repo.exec('git commit -m "merge"');
    expect(commit.exit).toBe(0);
    expect(repo.mergePending).toBeNull();
    const tip = repo.commits[repo.branches.main as string];
    expect(tip.parents).toHaveLength(2);
  });
});

describe('remote state survives a save and an older save still opens', () => {
  it('round-trips remotes, remote refs, upstreams and the fast-forward count', () => {
    const repo = published();
    repo.exec('git push -u origin main');
    const saved: GitRepoState = JSON.parse(JSON.stringify(repo.serialize()));
    expect(saved.remotes).toEqual([{ name: 'origin', url: REMOTE }]);
    expect(saved.upstreams.main).toEqual({ remote: 'origin', branch: 'main' });
    expect(Object.keys(saved.remoteRefs)).toEqual(['origin/main']);

    const restored = GitRepo.fromState(saved) as GitRepo;
    expect(restored.snapshot().remotes).toEqual([{ name: 'origin', url: REMOTE }]);
    expect(restored.snapshot().upstream?.ref).toBe('origin/main');
    expect(text(restored, 'git status')).toContain("Your branch is up to date with 'origin/main'.");
    expect(restored.exec('git push').lines.map((line) => line.text)).toContain('Everything up-to-date');
  });

  it('opens a save written before remotes existed', () => {
    const repo = published();
    const saved = JSON.parse(JSON.stringify(repo.serialize())) as Record<string, unknown>;
    delete saved.remotes;
    delete saved.remoteRefs;
    delete saved.upstreams;
    (saved.stats as Record<string, number>).fastForwards = undefined as unknown as number;

    const restored = GitRepo.fromState(saved as unknown as GitRepoState) as GitRepo;
    expect(restored.snapshot().remotes).toEqual([]);
    expect(restored.snapshot().upstream).toBeNull();
    expect(restored.exec('git push').exit).toBe(1);
    expect(restored.exec(`git remote add origin ${REMOTE}`).exit).toBe(0);
  });
});

describe('merge counted for the lesson', () => {
  it('a fast-forward merge is still a merge', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.exec('git switch -c feature');
    repo.workdir['feature.txt'] = 'feature\n';
    commitAll(repo, 'feature 작업');
    repo.exec('git switch main');

    expect(repo.snapshot().stats.fastForwards).toBe(0);
    expect(repo.exec('git merge feature').exit).toBe(0);
    expect(repo.snapshot().stats.fastForwards).toBe(1);
    expect(repo.snapshot().stats.merges).toBe(0);
  });

  it('makes a merge commit with --no-ff even where a fast-forward is possible', () => {
    const repo = bootstrap();
    commitAll(repo, 'base');
    repo.exec('git switch -c feature');
    repo.workdir['feature.txt'] = 'feature\n';
    commitAll(repo, 'feature 작업');
    repo.exec('git switch main');

    const merge = repo.exec('git merge --no-ff feature');
    expect(merge.exit).toBe(0);
    expect(merge.lines.map((line) => line.text).join('\n')).toContain("Merge made by the 'ort' strategy.");
    expect(repo.commits[repo.branches.main as string].parents).toHaveLength(2);
    expect(repo.snapshot().stats.merges).toBe(1);
    expect(repo.snapshot().stats.fastForwards).toBe(0);
    expect(repo.workdir['feature.txt']).toBe('feature\n');
  });

  it('merges a remote-tracking branch by name', () => {
    const repo = published();
    repo.exec('git push -u origin main');
    repo.exec('git switch -c docs');
    repo.workdir['docs.md'] = 'docs\n';
    commitAll(repo, '문서 추가');
    repo.exec('git push origin docs:main');
    repo.exec('git switch main');

    const merge = repo.exec('git merge origin/main');
    expect(merge.exit).toBe(0);
    expect(merge.lines.map((line) => line.text)).toContain('Fast-forward');
    expect(repo.workdir['docs.md']).toBe('docs\n');
  });
});

/** `git status` as one string — the lines a learner reads. */
function textoStatus(repo: GitRepo): string {
  return repo
    .exec('git status')
    .lines.map((line) => line.text)
    .join('\n');
}
