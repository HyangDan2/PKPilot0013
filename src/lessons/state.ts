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
}

export function gitFields(snapshot: GitSnapshot | null): GitCheckFields {
  return {
    gitInitialized: snapshot?.initialized ?? false,
    gitTotalCommits: snapshot?.totalCommits ?? 0,
    gitMergeCommits: snapshot?.commits.filter((commit) => commit.parents.length > 1).length ?? 0,
    gitBranch: snapshot?.branch ?? null,
    gitBranches: snapshot?.branches.map((branch) => ({ name: branch.name, sha: branch.sha, ahead: branch.ahead })) ?? [],
    gitMainTip: snapshot?.branches.find((branch) => branch.name === 'main')?.sha ?? null,
  };
}
