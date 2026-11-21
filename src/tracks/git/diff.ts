/**
 * Line diffing for the educational Git engine — the same unified format real
 * `git diff` prints, small enough to read in a terminal pane.
 */

type Op = { kind: 'same' | 'add' | 'del'; text: string };

export interface FileDiff {
  path: string;
  mode: 'modified' | 'added' | 'deleted';
  hunks: string[];
  additions: number;
  deletions: number;
}

export const splitLines = (text: string): string[] => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

function diffOps(before: string[], after: string[]): Op[] {
  const n = before.length;
  const m = after.length;
  // LCS table — the files in this sandbox are small, so the simple table wins.
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ kind: 'same', text: before[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: 'del', text: before[i] });
      i += 1;
    } else {
      ops.push({ kind: 'add', text: after[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: 'del', text: before[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ kind: 'add', text: after[j] });
    j += 1;
  }
  return ops;
}

const CONTEXT = 3;

function buildHunks(ops: Op[]): string[] {
  const changed = ops.map((op, index) => (op.kind === 'same' ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) return [];
  const blocks: [number, number][] = [];
  let start = Math.max(0, changed[0] - CONTEXT);
  let end = Math.min(ops.length - 1, changed[0] + CONTEXT);
  for (let k = 1; k < changed.length; k += 1) {
    const from = Math.max(0, changed[k] - CONTEXT);
    if (from <= end + 1) {
      end = Math.min(ops.length - 1, changed[k] + CONTEXT);
    } else {
      blocks.push([start, end]);
      start = from;
      end = Math.min(ops.length - 1, changed[k] + CONTEXT);
    }
  }
  blocks.push([start, end]);

  const out: string[] = [];
  for (const [from, to] of blocks) {
    const beforeStart = ops.slice(0, from).filter((op) => op.kind !== 'add').length;
    const afterStart = ops.slice(0, from).filter((op) => op.kind !== 'del').length;
    const beforeLen = ops.slice(from, to + 1).filter((op) => op.kind !== 'add').length;
    const afterLen = ops.slice(from, to + 1).filter((op) => op.kind !== 'del').length;
    out.push(
      `@@ -${beforeLen === 0 ? beforeStart : beforeStart + 1},${beforeLen} +${
        afterLen === 0 ? afterStart : afterStart + 1
      },${afterLen} @@`,
    );
    for (const op of ops.slice(from, to + 1)) {
      out.push(`${op.kind === 'add' ? '+' : op.kind === 'del' ? '-' : ' '}${op.text}`);
    }
  }
  return out;
}

/** One file's unified diff, headers included. */
export function diffFile(path: string, beforeText: string | undefined, afterText: string | undefined): FileDiff {
  const mode: FileDiff['mode'] =
    beforeText === undefined ? 'added' : afterText === undefined ? 'deleted' : 'modified';
  const before = splitLines(beforeText ?? '');
  const after = splitLines(afterText ?? '');
  const ops = diffOps(before, after);
  const hunks: string[] = [];
  hunks.push(`diff --git a/${path} b/${path}`);
  if (mode === 'added') {
    hunks.push('new file mode 100644');
    hunks.push('--- /dev/null');
    hunks.push(`+++ b/${path}`);
  } else if (mode === 'deleted') {
    hunks.push('deleted file mode 100644');
    hunks.push(`--- a/${path}`);
    hunks.push('+++ /dev/null');
  } else {
    hunks.push(`--- a/${path}`);
    hunks.push(`+++ b/${path}`);
  }
  hunks.push(...buildHunks(ops));
  return {
    path,
    mode,
    hunks,
    additions: ops.filter((op) => op.kind === 'add').length,
    deletions: ops.filter((op) => op.kind === 'del').length,
  };
}

/** Unified diff across two snapshots of the whole tree. */
export function diffTrees(before: Record<string, string>, after: Record<string, string>): FileDiff[] {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const diffs: FileDiff[] = [];
  for (const path of paths) {
    if (before[path] === after[path]) continue;
    diffs.push(diffFile(path, before[path], after[path]));
  }
  return diffs;
}

export interface DiffStat {
  files: number;
  additions: number;
  deletions: number;
}

export const diffStat = (diffs: FileDiff[]): DiffStat => ({
  files: diffs.length,
  additions: diffs.reduce((sum, d) => sum + d.additions, 0),
  deletions: diffs.reduce((sum, d) => sum + d.deletions, 0),
});

/** `2 files changed, 5 insertions(+), 1 deletion(-)` */
export function statLine(stat: DiffStat): string {
  if (stat.files === 0) return ' 0 files changed';
  const files = `${stat.files} file${stat.files === 1 ? '' : 's'} changed`;
  const parts = [files];
  if (stat.additions > 0) parts.push(`${stat.additions} insertion${stat.additions === 1 ? '' : 's'}(+)`);
  if (stat.deletions > 0) parts.push(`${stat.deletions} deletion${stat.deletions === 1 ? '' : 's'}(-)`);
  return ` ${parts.join(', ')}`;
}
