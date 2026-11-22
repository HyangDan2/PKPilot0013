/**
 * Mission checks, evaluated against the live sandbox state. A lesson declares
 * what counts as done in its frontmatter; this is the one place those
 * declarations become booleans.
 */
import type { CheckSpec, LessonState } from './types';

const matchesAnyFile = (state: LessonState, test: (code: string) => boolean): boolean => {
  const entries = Object.entries(state.files);
  if (entries.length === 0) return false;
  return entries.some(([, code]) => test(code));
};

export function evaluateCheck(check: CheckSpec, state: LessonState): boolean {
  switch (check.type) {
    case 'ran':
      return state.runs >= 1;
    case 'stdout-contains':
      return state.stdout.includes(check.value);
    case 'stdout-matches':
      return new RegExp(check.value).test(state.stdout);
    case 'stdout-lines': {
      const lines = state.stdout.split('\n').map((line) => line.trim());
      return check.values.every((value) => lines.includes(value));
    }
    case 'file-contains': {
      const wanted = check.value.trim();
      if (!wanted) return false;
      if (check.path) return (state.files[check.path] ?? '').includes(wanted);
      return matchesAnyFile(state, (code) => code.includes(wanted));
    }
    case 'file-matches': {
      const pattern = new RegExp(check.value);
      if (check.path) return pattern.test(state.files[check.path] ?? '');
      return matchesAnyFile(state, (code) => pattern.test(code));
    }
    case 'git-init':
      return state.gitInitialized;
    case 'git-commits':
      return state.gitTotalCommits >= check.min;
    case 'git-branch': {
      const branch = state.gitBranches.find((item) => item.name === check.name);
      if (!branch || !branch.sha) return false;
      // A branch counts once it has a commit of its own — a branch that still
      // points at main, or at an older commit main already contains, is not "a
      // branch of my own yet".
      const ahead = branch.ahead ?? (branch.sha === state.gitMainTip ? 0 : 1);
      return ahead >= 1;
    }
    case 'git-merge':
      return state.gitMergeCommits >= 1;
    case 'all':
      return check.checks.every((item) => evaluateCheck(item, state));
    default:
      return false;
  }
}
