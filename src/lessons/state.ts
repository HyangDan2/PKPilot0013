/**
 * Turns a Git snapshot into the fields a mission check reads, so the hook and
 * the unit suite measure the repository the same way.
 */
import type { GitSnapshot } from '../tracks/git/repo';

export interface GitCheckFields {
  gitInitialized: boolean;
  gitTotalCommits: number;
  gitMergeCommits: number;
  gitBranch: string | null;
  gitBranches: { name: string; sha: string | null; ahead: number }[];
  gitMainTip: string | null;
  gitRemotes: { name: string; url: string }[];
  gitRemoteBranches: { ref: string; remote: string; branch: string; sha: string | null; contained: boolean }[];
  gitFastForwards: number;
}

/** Every commit reachable from `sha`, read straight from the snapshot. */
function reachable(snapshot: GitSnapshot, sha: string | null): Set<string> {
  const bySha = new Map(snapshot.commits.map((commit) => [commit.sha, commit]));
  const seen = new Set<string>();
  const stack = sha ? [sha] : [];
  while (stack.length) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    const commit = bySha.get(current);
    if (commit) stack.push(...commit.parents);
  }
  return seen;
}

export function gitFields(snapshot: GitSnapshot | null): GitCheckFields {
  const branches = snapshot?.branches.map((branch) => ({ name: branch.name, sha: branch.sha, ahead: branch.ahead })) ?? [];
  return {
    gitInitialized: snapshot?.initialized ?? false,
    gitTotalCommits: snapshot?.totalCommits ?? 0,
    gitMergeCommits: snapshot?.commits.filter((commit) => commit.parents.length > 1).length ?? 0,
    gitBranch: snapshot?.branch ?? null,
    gitBranches: branches,
    gitMainTip: snapshot?.branches.find((branch) => branch.name === 'main')?.sha ?? null,
    gitRemotes: snapshot?.remotes.map((remote) => ({ name: remote.name, url: remote.url })) ?? [],
    gitRemoteBranches:
      snapshot?.remoteBranches.map((remote) => ({
        ref: remote.ref,
        remote: remote.remote,
        branch: remote.branch,
        sha: remote.sha,
        // "Pushed and not diverged": the remote tip is already part of the local
        // branch of the same name, so a later local commit keeps it true while a
        // force-push to older history does not.
        contained:
          !!remote.sha && reachable(snapshot, branches.find((branch) => branch.name === remote.branch)?.sha ?? null).has(remote.sha),
      })) ?? [],
    gitFastForwards: snapshot?.stats.fastForwards ?? 0,
  };
}
