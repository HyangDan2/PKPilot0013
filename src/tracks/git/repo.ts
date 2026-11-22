/**
 * An educational Git engine that behaves like the real thing for the commands a
 * beginner practises: init, status, add, commit, branch, switch/checkout, merge,
 * rebase, reset, log, diff, cherry-pick, restore, rm and show.
 *
 * It keeps whole-tree snapshots per commit (this is a teaching sandbox, not a
 * packfile implementation), which makes three-way merges, rebases and resets
 * easy to reason about — and easy to render as a commit graph.
 */
import { type CommandResult, type OutLine, blank, fail, mix, out, result } from '../types';
import { type FileDiff, diffStat, diffTrees, statLine } from './diff';

export interface Commit {
  sha: string;
  message: string;
  parents: string[];
  tree: Record<string, string>;
  time: number;
}

export type Head = { kind: 'branch'; name: string } | { kind: 'detached'; sha: string };

export type FileStatus = 'added' | 'modified' | 'deleted';

export interface StatusEntry {
  path: string;
  status: FileStatus;
}

export interface GitSnapshot {
  initialized: boolean;
  head: { kind: 'branch' | 'detached'; label: string; sha: string | null };
  branch: string | null;
  branches: { name: string; sha: string | null; current: boolean }[];
  staged: StatusEntry[];
  unstaged: StatusEntry[];
  untracked: string[];
  commits: { sha: string; message: string; parents: string[]; time: number; refs: string[] }[];
  totalCommits: number;
  mergePending: string | null;
  stats: { commits: number; merges: number; rebases: number };
}

const AUTHOR = 'HD2Lab Learner <learner@hd2lab.dev>';
const DEFAULT_BRANCH = 'main';

const tokenize = (input: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      has = true;
    } else if (/\s/.test(char)) {
      if (has || current) tokens.push(current);
      current = '';
      has = false;
    } else {
      current += char;
      has = true;
    }
  }
  if (has || current) tokens.push(current);
  return tokens;
};

const formatDate = (time: number): string => {
  const date = new Date(time);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()];
  const pad = (value: number) => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
  const offsetMinutes = pad(Math.abs(offset) % 60);
  return `${day} ${month} ${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )} ${date.getFullYear()} ${sign}${offsetHours}${offsetMinutes}`;
};

export class GitRepo {
  initialized = false;
  workdir: Record<string, string>;
  index: Record<string, string> = {};
  commits: Record<string, Commit> = {};
  branches: Record<string, string | null> = {};
  head: Head = { kind: 'branch', name: DEFAULT_BRANCH };
  mergePending: string | null = null;
  stats = { commits: 0, merges: 0, rebases: 0 };

  private clock = Date.now() - 1000 * 60 * 60 * 24 * 3;
  private serial = 0;
  private previousBranch: string | null = null;

  constructor(seed: Record<string, string>) {
    this.workdir = { ...seed };
  }

  // ── refs & trees ───────────────────────────────────────────────────────────
  get branch(): string | null {
    return this.head.kind === 'branch' ? this.head.name : null;
  }

  headSha(): string | null {
    if (this.head.kind === 'detached') return this.head.sha;
    return this.branches[this.head.name] ?? null;
  }

  headTree(): Record<string, string> {
    const sha = this.headSha();
    return sha && this.commits[sha] ? this.commits[sha].tree : {};
  }

  hasCommit(sha: string | null | undefined): sha is string {
    return !!sha && !!this.commits[sha];
  }

  resolve(ref: string | undefined): string | null {
    if (!ref || ref === 'HEAD') return this.headSha();
    if (ref === '@') return this.headSha();
    if (ref === '-') return this.previousBranch ? this.branches[this.previousBranch] ?? null : null;
    // `main~2`, `HEAD^`, `HEAD~` — the ancestor shorthands learners type most.
    const relative = ref.match(/^(.+?)(~|\^)(\d*)$/);
    if (relative) {
      let sha = this.resolve(relative[1]);
      const steps = relative[3] === '' || relative[3] === undefined ? 1 : Number(relative[3]);
      for (let i = 0; i < steps && this.hasCommit(sha); i += 1) {
        sha = this.commits[sha].parents[0] ?? null;
      }
      return sha;
    }
    if (ref in this.branches) return this.branches[ref];
    if (this.commits[ref]) return ref;
    const match = Object.keys(this.commits).find((sha) => sha.startsWith(ref));
    return match ?? null;
  }

  private nextTime(): number {
    this.clock += 1000 * 60 * (2 + Math.round(Math.random() * 40));
    return this.clock;
  }

  private newSha(message: string, tree: Record<string, string>, parents: string[]): string {
    const seed = `${message}|${JSON.stringify(tree)}|${parents.join(',')}|${this.serial++}`;
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    let sha = (hash >>> 0).toString(16).padStart(8, '0');
    while (this.commits[sha]) {
      hash = Math.imul(hash ^ 0x9e3779b9, 16777619);
      sha = (hash >>> 0).toString(16).padStart(8, '0');
    }
    return sha;
  }

  private createCommit(message: string, tree: Record<string, string>, parents: string[]): Commit {
    const commit: Commit = { sha: this.newSha(message, tree, parents), message, parents, tree: { ...tree }, time: this.nextTime() };
    this.commits[commit.sha] = commit;
    this.stats.commits += 1;
    if (parents.length > 1) this.stats.merges += 1;
    return commit;
  }

  // ── working tree & index diffs ─────────────────────────────────────────────
  private statusList(before: Record<string, string>, after: Record<string, string>): StatusEntry[] {
    const entries: StatusEntry[] = [];
    for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      if (before[path] === after[path]) continue;
      entries.push({
        path,
        status: before[path] === undefined ? 'added' : after[path] === undefined ? 'deleted' : 'modified',
      });
    }
    return entries;
  }

  stagedEntries(): StatusEntry[] {
    return this.statusList(this.headTree(), this.index);
  }

  unstagedEntries(): StatusEntry[] {
    const tracked = this.statusList(this.index, this.workdir);
    if (Object.keys(this.headTree()).length === 0 && Object.keys(this.index).length === 0) return [];
    return tracked;
  }

  untrackedFiles(): string[] {
    const tracked = new Set([...Object.keys(this.index), ...Object.keys(this.headTree())]);
    return Object.keys(this.workdir)
      .filter((path) => !tracked.has(path))
      .sort();
  }

  isDirty(): boolean {
    return (
      this.stagedEntries().length > 0 || this.unstagedEntries().length > 0 || this.untrackedFiles().length > 0
    );
  }

  snapshot(): GitSnapshot {
    const headSha = this.headSha();
    const refs: Record<string, string[]> = {};
    for (const [name, sha] of Object.entries(this.branches)) {
      if (!sha) continue;
      refs[sha] = [...(refs[sha] ?? []), name];
    }
    const currentName = this.branch;
    return {
      initialized: this.initialized,
      head: {
        kind: this.head.kind,
        label: this.head.kind === 'branch' ? this.head.name : `HEAD detached at ${this.head.sha.slice(0, 7)}`,
        sha: headSha,
      },
      branch: currentName,
      branches: Object.entries(this.branches)
        .map(([name, sha]) => ({ name, sha, current: name === currentName }))
        .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name)),
      staged: this.stagedEntries(),
      unstaged: this.unstagedEntries(),
      untracked: this.untrackedFiles(),
      commits: Object.values(this.commits)
        .sort((a, b) => b.time - a.time)
        .map((commit) => ({
          sha: commit.sha,
          message: commit.message,
          parents: commit.parents,
          time: commit.time,
          refs: refs[commit.sha] ?? [],
        })),
      totalCommits: Object.keys(this.commits).length,
      mergePending: this.mergePending,
      stats: { ...this.stats },
    };
  }

  // ── history helpers ────────────────────────────────────────────────────────
  private ancestors(sha: string | null): Set<string> {
    const seen = new Set<string>();
    const stack = sha ? [sha] : [];
    while (stack.length) {
      const current = stack.pop() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      const commit = this.commits[current];
      if (commit) stack.push(...commit.parents);
    }
    return seen;
  }

  private mergeBase(a: string | null, b: string | null): string | null {
    if (!this.hasCommit(a) || !this.hasCommit(b)) return null;
    const fromB = this.ancestors(b);
    const candidates = [...this.ancestors(a)].filter((sha) => fromB.has(sha));
    if (candidates.length === 0) return null;
    candidates.sort((x, y) => this.commits[y].time - this.commits[x].time);
    return candidates[0];
  }

  /** Commits reachable from `sha` but not from `stop`, oldest first. */
  private commitsSince(sha: string | null, stop: string | null): Commit[] {
    if (!this.hasCommit(sha)) return [];
    const stopSet = this.ancestors(stop);
    const collected: Commit[] = [];
    const seen = new Set<string>();
    const walk = (current: string) => {
      if (seen.has(current) || stopSet.has(current)) return;
      seen.add(current);
      const commit = this.commits[current];
      if (!commit) return;
      collected.push(commit);
      for (const parent of commit.parents) walk(parent);
    };
    walk(sha);
    return collected.sort((a, b) => a.time - b.time);
  }

  private isAncestor(maybeAncestor: string | null, sha: string | null): boolean {
    return !!maybeAncestor && this.ancestors(sha).has(maybeAncestor);
  }

  // ── three-way merge ────────────────────────────────────────────────────────
  private mergeTree(
    base: Record<string, string>,
    ours: Record<string, string>,
    theirs: Record<string, string>,
    theirsLabel: string,
  ): { tree: Record<string, string>; conflicts: string[] } {
    const tree: Record<string, string> = {};
    const conflicts: string[] = [];
    const paths = [...new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])].sort();
    for (const path of paths) {
      const b = base[path];
      const o = ours[path];
      const t = theirs[path];
      if (o === t) {
        if (o !== undefined) tree[path] = o;
        continue;
      }
      if (o === b) {
        if (t !== undefined) tree[path] = t;
        continue;
      }
      if (t === b) {
        if (o !== undefined) tree[path] = o;
        continue;
      }
      const merged = [
        '<<<<<<< HEAD',
        o ?? '',
        '=======',
        t ?? '',
        `>>>>>>> ${theirsLabel}`,
        '',
      ].join('\n');
      tree[path] = merged;
      conflicts.push(path);
    }
    return { tree, conflicts };
  }

  // ── commands ───────────────────────────────────────────────────────────────
  exec(input: string): CommandResult {
    const tokens = tokenize(input.trim());
    if (tokens.length === 0) return result([]);
    if (tokens[0] !== 'git') return this.shellCommand(tokens);
    return this.git(tokens.slice(1));
  }

  private git(args: string[]): CommandResult {
    const [sub, ...rest] = args;
    if (!sub) {
      return fail([
        out('usage: git <command> [<args>]', 'plain'),
        blank(),
        out('흔히 쓰는 명령:', 'dim'),
        out('   init      저장소를 초기화합니다', 'dim'),
        out('   status    작업 트리와 스테이징 상태를 봅니다', 'dim'),
        out('   add       변경 사항을 스테이징합니다', 'dim'),
        out('   commit    스테이징된 변경을 기록합니다', 'dim'),
        out('   branch    브랜치를 만들거나 나열합니다', 'dim'),
        out('   switch    브랜치를 전환합니다', 'dim'),
        out('   merge     다른 브랜치를 합칩니다', 'dim'),
        out('   rebase    커밋을 다른 기반 위로 옮깁니다', 'dim'),
        out('   reset     HEAD를 되돌립니다', 'dim'),
        out('   log       커밋 기록을 봅니다', 'dim'),
        out('   diff      변경 내용을 봅니다', 'dim'),
      ]);
    }
    if (sub !== 'init' && !this.initialized) {
      return fail([out(`fatal: not a git repository (or any of the parent directories): .git`, 'err')]);
    }
    switch (sub) {
      case 'init':
        return this.cmdInit();
      case 'status':
        return this.cmdStatus();
      case 'add':
        return this.cmdAdd(rest);
      case 'commit':
        return this.cmdCommit(rest);
      case 'branch':
        return this.cmdBranch(rest);
      case 'switch':
        return this.cmdCheckout(rest, 'switch');
      case 'checkout':
        return this.cmdCheckout(rest, 'checkout');
      case 'merge':
        return this.cmdMerge(rest);
      case 'rebase':
        return this.cmdRebase(rest);
      case 'reset':
        return this.cmdReset(rest);
      case 'log':
        return this.cmdLog(rest);
      case 'diff':
        return this.cmdDiff(rest);
      case 'cherry-pick':
        return this.cmdCherryPick(rest);
      case 'restore':
        return this.cmdRestore(rest);
      case 'rm':
        return this.cmdRm(rest);
      case 'show':
        return this.cmdShow(rest);
      case 'help':
        return this.git([]);
      default:
        return fail([out(`git: '${sub}' is not a git command. See 'git --help'.`, 'err')]);
    }
  }

  private cmdInit(): CommandResult {
    if (this.initialized) {
      return result([out(`Reinitialized existing Git repository in /home/learner/work/.git/`, 'plain')]);
    }
    this.initialized = true;
    this.branches = { [DEFAULT_BRANCH]: null };
    this.head = { kind: 'branch', name: DEFAULT_BRANCH };
    this.stats = { commits: 0, merges: 0, rebases: 0 };
    return result([
      out(`Initialized empty Git repository in /home/learner/work/.git/`, 'ok'),
      out(`기본 브랜치: ${DEFAULT_BRANCH}`, 'dim'),
    ]);
  }

  private cmdStatus(): CommandResult {
    const lines: OutLine[] = [];
    if (this.head.kind === 'detached') {
      lines.push(out(`HEAD detached at ${this.head.sha.slice(0, 7)}`, 'warn'));
    } else {
      lines.push(mix('On branch ', { text: this.head.name, tone: 'branch' }));
    }
    if (this.mergePending) {
      lines.push(out(`You have unmerged paths.`, 'warn'));
      lines.push(out(`  (fix conflicts and run "git commit")`, 'dim'));
    }
    const staged = this.stagedEntries();
    const unstaged = this.unstagedEntries();
    const untracked = this.untrackedFiles();

    if (staged.length) {
      lines.push(blank(), out('Changes to be committed:', 'ok'));
      lines.push(out('  (use "git restore --staged <file>..." to unstage)', 'dim'));
      for (const entry of staged) {
        const label = entry.status === 'added' ? 'new file:  ' : entry.status === 'deleted' ? 'deleted:   ' : 'modified:  ';
        lines.push(mix(`\t${label}`, { text: entry.path, tone: entry.status === 'deleted' ? 'err' : 'ok' }));
      }
    }
    if (unstaged.length) {
      lines.push(blank(), out('Changes not staged for commit:', 'err'));
      lines.push(out('  (use "git add <file>..." to update what will be committed)', 'dim'));
      for (const entry of unstaged) {
        const label = entry.status === 'deleted' ? 'deleted:   ' : 'modified:  ';
        lines.push(mix(`\t${label}`, { text: entry.path, tone: 'err' }));
      }
    }
    if (untracked.length) {
      lines.push(blank(), out('Untracked files:', 'err'));
      lines.push(out('  (use "git add <file>..." to include in what will be committed)', 'dim'));
      for (const path of untracked) lines.push(mix('\t', { text: path, tone: 'err' }));
    }
    if (!staged.length && !unstaged.length && !untracked.length) {
      lines.push(blank(), out('nothing to commit, working tree clean', 'plain'));
    } else if (!staged.length) {
      lines.push(blank(), out('no changes added to commit (use "git add" and/or "git commit -a")', 'plain'));
    }
    return result(lines);
  }

  private cmdAdd(args: string[]): CommandResult {
    const paths = args.filter((arg) => !arg.startsWith('-'));
    if (paths.length === 0) {
      return fail([out('Nothing specified, nothing added.', 'err'), out('hint: Maybe you wanted to say \'git add .\'?', 'dim')]);
    }
    const lines: OutLine[] = [];
    const all = paths.includes('.') || paths.includes('*') || args.includes('-A') || args.includes('--all');
    if (all) {
      this.index = { ...this.workdir };
      return result([]);
    }
    for (const path of paths) {
      if (path in this.workdir) {
        this.index[path] = this.workdir[path];
      } else if (path in this.index) {
        delete this.index[path];
      } else {
        lines.push(out(`fatal: pathspec '${path}' did not match any files`, 'err'));
      }
    }
    return lines.length ? fail(lines) : result([]);
  }

  private cmdCommit(args: string[]): CommandResult {
    let message: string | null = null;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '-m' || arg === '--message') {
        message = args[i + 1] ?? '';
        i += 1;
      } else if (arg.startsWith('-m')) {
        message = arg.slice(2);
      } else if (arg === '-am' || arg === '-a') {
        // handled below: stage every tracked change first
        this.index = { ...this.index, ...Object.fromEntries(Object.keys(this.workdir).map((p) => [p, this.workdir[p]])) };
      }
    }
    if (message === null) {
      return fail([
        out('error: switch `m` requires a value', 'err'),
        out('hint: git commit -m "커밋 메시지" 형식으로 입력해 주세요.', 'dim'),
      ]);
    }
    if (message.trim() === '') {
      return fail([out('Aborting commit due to empty commit message.', 'err')]);
    }
    const staged = this.stagedEntries();
    if (staged.length === 0) {
      const untracked = this.untrackedFiles().length;
      const unstaged = this.unstagedEntries().length;
      const lines = [out('On branch: ' + (this.branch ?? 'HEAD'), 'plain')];
      if (unstaged) {
        lines.push(out('no changes added to commit (use "git add" and/or "git commit -a")', 'plain'));
      } else if (untracked) {
        lines.push(out('nothing added to commit but untracked files present (use "git add" to track)', 'plain'));
      } else {
        lines.push(out('nothing to commit, working tree clean', 'plain'));
      }
      return fail(lines);
    }
    const tree = { ...this.index };
    const parents: string[] = [];
    const headSha = this.headSha();
    if (this.hasCommit(headSha)) parents.push(headSha);
    if (this.mergePending) {
      const otherTip = this.branches[this.mergePending];
      if (this.hasCommit(otherTip) && !parents.includes(otherTip)) parents.push(otherTip);
    }
    const commit = this.createCommit(message, tree, parents);
    if (this.head.kind === 'branch') this.branches[this.head.name] = commit.sha;
    else this.head = { kind: 'detached', sha: commit.sha };
    this.index = { ...tree };
    this.mergePending = null;

    const lines: OutLine[] = [];
    lines.push(mix(`[${this.branch ?? 'detached HEAD'} `, { text: commit.sha.slice(0, 7), tone: 'sha' }, `] ${message}`));
    const diffs = diffTrees(parents[0] ? this.commits[parents[0]].tree : {}, tree);
    for (const diff of diffs.filter((entry) => entry.mode !== 'modified')) {
      lines.push(out(` ${diff.mode === 'added' ? 'create' : 'delete'} mode 100644 ${diff.path}`, 'dim'));
    }
    lines.push(out(statLine(diffStat(diffs)), 'plain'));
    return result(lines);
  }

  private cmdBranch(args: string[]): CommandResult {
    const verbose = args.includes('-v') || args.includes('-vv');
    const deleting = args.includes('-d') || args.includes('-D');
    const names = args.filter((arg) => !arg.startsWith('-'));
    if (deleting) {
      const name = names[0];
      if (!name) return fail([out('fatal: branch name required', 'err')]);
      if (!(name in this.branches)) return fail([out(`error: branch '${name}' not found.`, 'err')]);
      if (this.branch === name) {
        return fail([out(`error: cannot delete branch '${name}' checked out at '/home/learner/work'`, 'err')]);
      }
      const sha = this.branches[name];
      if (args.includes('-d') && !this.isAncestor(sha, this.headSha())) {
        const other = Object.keys(this.branches).find((b) => b !== name && this.isAncestor(sha, this.branches[b]));
        return fail([
          out(`error: the branch '${name}' is not fully merged.`, 'err'),
          out(`hint: '${name}' 브랜치가 ${other ?? '다른 브랜치'}에 병합되지 않았습니다. 그래도 지우려면 -D를 쓰세요.`, 'dim'),
        ]);
      }
      delete this.branches[name];
      return result([out(`Deleted branch ${name} (was ${sha?.slice(0, 7)}).`, 'ok')]);
    }
    if (names.length === 0) {
      const lines: OutLine[] = [];
      if (!Object.keys(this.branches).length) return result([]);
      for (const [name, sha] of Object.entries(this.branches)) {
        const current = name === this.branch;
        if (verbose) {
          const commit = this.hasCommit(sha) ? this.commits[sha] : null;
          lines.push(
            mix(current ? '* ' : '  ', { text: name.padEnd(16), tone: current ? 'branch' : 'plain' }, {
              text: sha ? sha.slice(0, 7) : '(커밋 없음)',
              tone: 'sha',
            }, ` ${commit ? commit.message : ''}`),
          );
        } else {
          lines.push(out(`${current ? '* ' : '  '}${name}`, current ? 'branch' : 'plain'));
        }
      }
      if (this.head.kind === 'detached') lines.unshift(out(`* (HEAD detached at ${this.head.sha.slice(0, 7)})`, 'warn'));
      return result(lines);
    }
    const name = names[0];
    if (name in this.branches) return fail([out(`fatal: a branch named '${name}' already exists`, 'err')]);
    const start = this.resolve(names[1]) ?? this.headSha();
    this.branches[name] = start;
    return result([]);
  }

  private cmdCheckout(args: string[], flavor: 'switch' | 'checkout'): CommandResult {
    let create = false;
    let detach = false;
    const names: string[] = [];
    for (const arg of args) {
      if (arg === '-b' || arg === '-c' || arg === '-C') create = true;
      else if (arg === '--detach' || arg === '-d') detach = true;
      else if (!arg.startsWith('-')) names.push(arg);
    }
    const target = names[0];
    if (!target) {
      return fail([
        out(`fatal: ${flavor === 'switch' ? "missing branch or commit argument" : "you must specify path(s) to restore"}`, 'err'),
      ]);
    }
    if (create) {
      if (target in this.branches) return fail([out(`fatal: a branch named '${target}' already exists`, 'err')]);
      const start = this.resolve(names[1]) ?? this.headSha();
      this.branches[target] = start;
      this.previousBranch = this.branch;
      this.head = { kind: 'branch', name: target };
      const tree = this.hasCommit(start) ? this.commits[start].tree : {};
      const carry = this.dirtyWorkdir(tree);
      this.workdir = { ...tree, ...carry };
      this.index = { ...tree };
      return result([out(`Switched to a new branch '${target}'`, 'ok')]);
    }
    if (target === '-' || target in this.branches) {
      const name = target === '-' ? this.previousBranch : target;
      if (!name || !(name in this.branches)) return fail([out('fatal: invalid reference: -', 'err')]);
      return this.checkoutBranch(name);
    }
    const sha = this.resolve(target);
    if (!sha || !detach) {
      return fail([
        out(`fatal: invalid reference: ${target}`, 'err'),
        out(`hint: 브랜치를 전환하려면 존재하는 브랜치 이름을 입력해 주세요.`, 'dim'),
      ]);
    }
    const lines: OutLine[] = [
      out(`Note: switching to '${sha.slice(0, 7)}'.`, 'warn'),
      blank(),
      out(`You are in 'detached HEAD' state. 실습 뒤에는 "git switch main"으로 돌아오세요.`, 'dim'),
      blank(),
    ];
    this.previousBranch = this.branch;
    this.head = { kind: 'detached', sha };
    const tree = this.commits[sha].tree;
    this.workdir = { ...tree };
    this.index = { ...tree };
    lines.push(out(`HEAD is now at ${sha.slice(0, 7)} ${this.commits[sha].message}`, 'plain'));
    return result(lines);
  }

  private dirtyWorkdir(target: Record<string, string>): Record<string, string> {
    const carry: Record<string, string> = {};
    const dirty = new Set([...this.unstagedEntries().map((e) => e.path), ...this.untrackedFiles()]);
    for (const path of dirty) {
      const current = this.workdir[path];
      if (current !== target[path]) carry[path] = current;
    }
    return carry;
  }

  private checkoutBranch(name: string): CommandResult {
    const sha = this.branches[name];
    const tree = this.hasCommit(sha) ? this.commits[sha].tree : {};
    const dirty = this.unstagedEntries().filter((entry) => this.headTree()[entry.path] !== tree[entry.path]);
    if (dirty.length) {
      return fail([
        out(`error: Your local changes to the following files would be overwritten by checkout:`, 'err'),
        ...dirty.map((entry) => out(`\t${entry.path}`, 'err')),
        out('Please commit your changes or stash them before you switch branches.', 'dim'),
        out('Aborting', 'err'),
      ]);
    }
    const carry = this.dirtyWorkdir(tree);
    this.previousBranch = this.branch;
    this.head = { kind: 'branch', name };
    this.workdir = { ...tree, ...carry };
    this.index = { ...tree, ...Object.fromEntries(Object.entries(carry).filter(([path]) => path in this.index)) };
    const lines: OutLine[] = [out(`Switched to branch '${name}'`, 'ok')];
    if (carry && Object.keys(carry).length) {
      lines.push(out(`M\t${Object.keys(carry).join(', ')}`, 'warn'));
    }
    return result(lines);
  }

  private cmdMerge(args: string[]): CommandResult {
    const name = args.find((arg) => !arg.startsWith('-'));
    if (args.includes('--abort')) {
      this.mergePending = null;
      this.workdir = { ...this.headTree() };
      this.index = { ...this.headTree() };
      return result([out('Merge aborted.', 'warn')]);
    }
    if (!name) return fail([out('fatal: No commit specified and merge.defaultToUpstream not set.', 'err')]);
    if (!(name in this.branches)) {
      return fail([out(`merge: ${name} - not something we can merge`, 'err')]);
    }
    if (this.branch === name) return result([out('Already up to date.', 'plain')]);
    const ourSha = this.headSha();
    const theirSha = this.branches[name];
    if (!this.hasCommit(theirSha)) return fail([out(`merge: ${name} - not something we can merge`, 'err')]);
    if (!this.hasCommit(ourSha)) {
      return this.checkoutBranch(name);
    }
    const base = this.mergeBase(ourSha, theirSha);
    if (base === theirSha) return result([out('Already up to date.', 'plain')]);
    if (base === ourSha) {
      const theirs = this.commits[theirSha];
      const diffs = diffTrees(this.commits[ourSha].tree, theirs.tree);
      if (this.branch) this.branches[this.branch] = theirSha;
      else this.head = { kind: 'detached', sha: theirSha };
      this.workdir = { ...theirs.tree };
      this.index = { ...theirs.tree };
      return result([
        out(`Updating ${ourSha.slice(0, 7)}..${theirSha.slice(0, 7)}`, 'plain'),
        out('Fast-forward', 'ok'),
        ...diffs.map((diff) => out(` ${diff.path} | ${diff.additions + diff.deletions} ${'+'.repeat(Math.min(diff.additions, 12))}${'-'.repeat(Math.min(diff.deletions, 12))}`, 'dim')),
        out(statLine(diffStat(diffs)), 'plain'),
      ]);
    }

    const baseTree = this.commits[base as string].tree;
    const { tree, conflicts } = this.mergeTree(baseTree, this.commits[ourSha].tree, this.commits[theirSha].tree, name);
    const lines: OutLine[] = [];
    for (const path of Object.keys(tree)) {
      if (conflicts.includes(path)) continue;
      if (this.commits[ourSha].tree[path] !== tree[path]) lines.push(out(`Auto-merging ${path}`, 'dim'));
    }
    if (conflicts.length) {
      for (const path of conflicts) {
        lines.push(out(`CONFLICT (content): Merge conflict in ${path}`, 'err'));
      }
      lines.push(out('Automatic merge failed; fix conflicts and then commit the result.', 'err'));
      lines.push(out(`hint: 충돌 표시(<<<<<<<, =======, >>>>>>>)를 지우고 파일을 정리한 뒤 "git add ."와 "git commit -m \\"merge\\""를 실행해 주세요.`, 'dim'));
      this.workdir = { ...tree };
      this.mergePending = name;
      return fail(lines);
    }
    const commit = this.createCommit(`Merge branch '${name}'`, tree, [ourSha, theirSha]);
    if (this.branch) this.branches[this.branch] = commit.sha;
    this.workdir = { ...tree };
    this.index = { ...tree };
    const diffs = diffTrees(this.commits[ourSha].tree, tree);
    lines.push(out(`Merge made by the 'ort' strategy.`, 'ok'));
    lines.push(out(statLine(diffStat(diffs)), 'plain'));
    return result(lines);
  }

  private cmdRebase(args: string[]): CommandResult {
    const name = args.find((arg) => !arg.startsWith('-'));
    if (!name) return fail([out('fatal: no upstream specified', 'err')]);
    if (args.includes('--abort')) {
      return result([out('rebase: 취소할 진행 중인 rebase가 없습니다.', 'dim')]);
    }
    const onto = name === 'HEAD' ? this.headSha() : this.resolve(name);
    if (!this.hasCommit(onto)) return fail([out(`fatal: invalid upstream '${name}'`, 'err')]);
    const ourSha = this.headSha();
    if (!this.hasCommit(ourSha)) return fail([out('fatal: 현재 브랜치에 커밋이 없습니다.', 'err')]);
    const base = this.mergeBase(ourSha, onto);
    if (base === onto) return result([out(`Current branch ${this.branch ?? 'HEAD'} is up to date.`, 'plain')]);
    const replay = this.commitsSince(ourSha, onto);
    if (replay.length === 0) return result([out(`Current branch ${this.branch ?? 'HEAD'} is up to date.`, 'plain')]);

    const original = { workdir: { ...this.workdir }, index: { ...this.index }, head: { ...this.head } };
    const lines: OutLine[] = [
      out('First, rewinding head to replay your work on top of it...', 'dim'),
    ];
    let currentTree = { ...this.commits[onto].tree };
    let currentSha: string = onto;
    for (const commit of replay) {
      const parentTree = commit.parents[0] ? this.commits[commit.parents[0]].tree : {};
      const merged = this.mergeTree(parentTree, currentTree, commit.tree, 'rebase');
      if (merged.conflicts.length) {
        this.workdir = { ...original.workdir };
        this.index = { ...original.index };
        this.head = original.head as Head;
        return fail([
          out(`error: could not apply ${commit.sha.slice(0, 7)}... ${commit.message}`, 'err'),
          ...merged.conflicts.map((path) => out(`CONFLICT (content): Merge conflict in ${path}`, 'err')),
          out('rebase: 충돌이 발생해 원래 히스토리를 그대로 두었습니다. 충돌 파일을 정리한 뒤 다시 시도해 주세요.', 'warn'),
        ]);
      }
      const applied = this.createCommit(commit.message, merged.tree, [currentSha]);
      lines.push(out(`Applying: ${commit.message}`, 'plain'));
      currentSha = applied.sha;
      currentTree = merged.tree;
    }
    if (this.branch) this.branches[this.branch] = currentSha;
    else this.head = { kind: 'detached', sha: currentSha };
    this.workdir = { ...currentTree };
    this.index = { ...currentTree };
    this.stats.rebases += 1;
    lines.push(out(`Successfully rebased and updated refs/heads/${this.branch ?? 'HEAD'}.`, 'ok'));
    return result(lines);
  }

  private cmdReset(args: string[]): CommandResult {
    const hard = args.includes('--hard');
    const soft = args.includes('--soft');
    const ref = args.find((arg) => !arg.startsWith('-')) ?? 'HEAD';
    const sha = this.resolve(ref);
    if (!sha) return fail([out(`fatal: ambiguous argument '${ref}': unknown revision or path not in the working tree.`, 'err')]);
    const tree = this.commits[sha].tree;
    if (this.branch) this.branches[this.branch] = sha;
    else this.head = { kind: 'detached', sha };
    const lines: OutLine[] = [];
    if (hard) {
      this.workdir = { ...tree };
      this.index = { ...tree };
      lines.push(out(`HEAD is now at ${sha.slice(0, 7)} ${this.commits[sha].message}`, 'ok'));
    } else if (!soft) {
      this.index = { ...tree };
      const unstaged = this.unstagedEntries();
      if (unstaged.length) {
        lines.push(out('Unstaged changes after reset:', 'plain'));
        for (const entry of unstaged) lines.push(out(`M\t${entry.path}`, 'err'));
      }
    }
    return result(lines);
  }

  private reachableCommits(all: boolean): Commit[] {
    if (!all) return this.commitsSince(this.headSha(), null);
    const seen = new Set<string>();
    for (const sha of Object.values(this.branches)) for (const id of this.ancestors(sha)) seen.add(id);
    for (const id of this.ancestors(this.headSha())) seen.add(id);
    return [...seen].map((id) => this.commits[id]).sort((a, b) => b.time - a.time);
  }

  private cmdLog(args: string[]): CommandResult {
    const oneline = args.includes('--oneline');
    const graph = args.includes('--graph');
    const all = args.includes('--all');
    let limit = 0;
    const nIndex = args.findIndex((arg) => arg === '-n' || arg === '--max-count');
    if (nIndex >= 0) limit = Number(args[nIndex + 1]) || 0;
    const dashN = args.find((arg) => /^-\d+$/.test(arg));
    if (dashN) limit = Number(dashN.slice(1));
    let commits = this.reachableCommits(all);
    if (limit > 0) commits = commits.slice(0, limit);
    if (commits.length === 0) {
      return fail([out(`fatal: your current branch '${this.branch ?? 'HEAD'}' does not have any commits yet`, 'err')]);
    }
    const lines: OutLine[] = [];
    if (oneline) {
      for (const commit of commits) {
        const refs = this.decorations(commit.sha);
        lines.push(
          mix(graph ? '* ' : '', { text: commit.sha.slice(0, 7), tone: 'sha' }, refs ? ` (${refs})` : '', ` ${commit.message}`),
        );
        if (graph && commit.parents.length > 1) lines.push(out('|\\', 'dim'));
      }
      return result(lines);
    }
    for (const commit of commits) {
      const refs = this.decorations(commit.sha);
      lines.push(
        mix(graph ? '* ' : '', 'commit ', { text: commit.sha, tone: 'sha' }, refs ? ` (${refs})` : ''),
      );
      lines.push(out(`Author: ${AUTHOR}`, 'dim'));
      lines.push(out(`Date:   ${formatDate(commit.time)}`, 'dim'));
      lines.push(blank());
      lines.push(out(`    ${commit.message}`, 'plain'));
      lines.push(blank());
    }
    return result(lines);
  }

  private decorations(sha: string): string {
    const parts = Object.entries(this.branches)
      .filter(([, tip]) => tip === sha)
      .map(([name]) => name);
    const head = this.head;
    if (this.headSha() === sha && head.kind === 'branch') {
      return [`HEAD -> ${head.name}`, ...parts.filter((name) => name !== head.name)].join(', ');
    }
    if (this.headSha() === sha) return ['HEAD', ...parts].join(', ');
    return parts.join(', ');
  }

  private cmdDiff(args: string[]): CommandResult {
    const staged = args.includes('--staged') || args.includes('--cached');
    const paths = args.filter((arg) => !arg.startsWith('-'));
    const before = staged ? this.headTree() : this.index;
    const after = staged ? this.index : this.workdir;
    let diffs: FileDiff[] = diffTrees(before, after);
    if (paths.length) diffs = diffs.filter((diff) => paths.includes(diff.path));
    if (diffs.length === 0) return result([]);
    const lines: OutLine[] = [];
    for (const diff of diffs) {
      for (const line of diff.hunks) {
        if (line.startsWith('+++') || line.startsWith('---')) lines.push(out(line, 'dim'));
        else if (line.startsWith('diff') || line.startsWith('new file') || line.startsWith('deleted file')) lines.push(out(line, 'dim'));
        else if (line.startsWith('@@')) lines.push(out(line, 'accent'));
        else if (line.startsWith('+')) lines.push(out(line, 'add'));
        else if (line.startsWith('-')) lines.push(out(line, 'del'));
        else lines.push(out(line, 'plain'));
      }
    }
    return result(lines);
  }

  private cmdCherryPick(args: string[]): CommandResult {
    const ref = args.find((arg) => !arg.startsWith('-'));
    const sha = this.resolve(ref);
    if (!sha) return fail([out(`fatal: bad revision '${ref}'`, 'err')]);
    const commit = this.commits[sha];
    const parentTree = commit.parents[0] ? this.commits[commit.parents[0]].tree : {};
    const ours = this.headTree();
    const merged = this.mergeTree(parentTree, ours, commit.tree, sha.slice(0, 7));
    if (merged.conflicts.length) {
      return fail([
        out(`error: could not apply ${sha.slice(0, 7)}... ${commit.message}`, 'err'),
        ...merged.conflicts.map((path) => out(`CONFLICT (content): Merge conflict in ${path}`, 'err')),
        out('cherry-pick: 충돌로 중단했습니다. 변경 사항은 적용되지 않았습니다.', 'warn'),
      ]);
    }
    const parents = this.hasCommit(this.headSha()) ? [this.headSha() as string] : [];
    const created = this.createCommit(commit.message, merged.tree, parents);
    if (this.branch) this.branches[this.branch] = created.sha;
    else this.head = { kind: 'detached', sha: created.sha };
    this.workdir = { ...merged.tree };
    this.index = { ...merged.tree };
    return result([
      mix(`[${this.branch ?? 'detached'} `, { text: created.sha.slice(0, 7), tone: 'sha' }, `] ${commit.message}`),
      out(statLine(diffStat(diffTrees(parents[0] ? this.commits[parents[0]].tree : {}, merged.tree))), 'plain'),
    ]);
  }

  private cmdRestore(args: string[]): CommandResult {
    const staged = args.includes('--staged');
    const paths = args.filter((arg) => !arg.startsWith('-')).filter((arg) => arg !== 'HEAD');
    if (paths.length === 0) return fail([out('fatal: you must specify path(s) to restore', 'err')]);
    const head = this.headTree();
    for (const path of paths) {
      if (staged) {
        if (head[path] !== undefined) this.index[path] = head[path];
        else delete this.index[path];
      } else if (this.index[path] !== undefined) {
        this.workdir[path] = this.index[path];
      } else if (head[path] !== undefined) {
        this.workdir[path] = head[path];
      } else {
        return fail([out(`error: pathspec '${path}' did not match any file(s) known to git`, 'err')]);
      }
    }
    return result([]);
  }

  private cmdRm(args: string[]): CommandResult {
    const cached = args.includes('--cached');
    const paths = args.filter((arg) => !arg.startsWith('-'));
    if (!paths.length) return fail([out('fatal: No pathspec was given. Which files should I remove?', 'err')]);
    const lines: OutLine[] = [];
    for (const path of paths) {
      if (!(path in this.index)) {
        lines.push(out(`fatal: pathspec '${path}' did not match any files`, 'err'));
        continue;
      }
      delete this.index[path];
      if (!cached) delete this.workdir[path];
      lines.push(out(`rm '${path}'`, 'plain'));
    }
    return lines.some((line) => line.tone === 'err') ? fail(lines) : result(lines);
  }

  private cmdShow(args: string[]): CommandResult {
    const ref = args.find((arg) => !arg.startsWith('-')) ?? 'HEAD';
    const sha = this.resolve(ref);
    if (!sha) return fail([out(`fatal: bad revision '${ref}'`, 'err')]);
    const commit = this.commits[sha];
    const lines: OutLine[] = [
      mix('commit ', { text: commit.sha, tone: 'sha' }, this.decorations(sha) ? ` (${this.decorations(sha)})` : ''),
      out(`Author: ${AUTHOR}`, 'dim'),
      out(`Date:   ${formatDate(commit.time)}`, 'dim'),
      blank(),
      out(`    ${commit.message}`, 'plain'),
      blank(),
    ];
    const diffs = diffTrees(commit.parents[0] ? this.commits[commit.parents[0]].tree : {}, commit.tree);
    for (const diff of diffs) {
      for (const line of diff.hunks) {
        if (line.startsWith('+') && !line.startsWith('+++')) lines.push(out(line, 'add'));
        else if (line.startsWith('-') && !line.startsWith('---')) lines.push(out(line, 'del'));
        else if (line.startsWith('@@')) lines.push(out(line, 'accent'));
        else lines.push(out(line, 'dim'));
      }
    }
    return result(lines);
  }

  // ── a little shell so the workspace can be inspected ───────────────────────
  private shellCommand(tokens: string[]): CommandResult {
    const [cmd, ...args] = tokens;
    switch (cmd) {
      case 'ls': {
        const files = Object.keys(this.workdir).sort();
        if (!files.length) return result([]);
        return result(files.map((path) => mix({ text: path, tone: 'path' })));
      }
      case 'cat': {
        const path = args[0];
        if (!path || !(path in this.workdir)) {
          return fail([out(`cat: ${path ?? ''}: No such file or directory`, 'err')]);
        }
        return result(this.workdir[path].replace(/\n$/, '').split('\n').map((line) => out(line)));
      }
      case 'pwd':
        return result([out('/home/learner/work', 'path')]);
      case 'clear':
        return { lines: [], exit: 0, clear: true };
      case 'help':
        return this.git([]);
      default:
        return fail([out(`bash: ${cmd}: command not found`, 'err')]);
    }
  }
}

/** Files the Git track starts with — small enough to read, real enough to matter. */
export const gitSeed = (): Record<string, string> => ({
  'README.md': [
    '# CodePlayground · Git 실습 저장소',
    '',
    '이 저장소는 Git을 손으로 익히는 공간입니다.',
    '아래 단계를 차례대로 따라 해 보세요.',
    '',
    '1. git init',
    '2. git add . && git commit -m "첫 커밋"',
    '3. 브랜치를 만들고 이동하기',
  ].join('\n'),
  'app.js': [
    '// CodePlayground · 작은 카운터 앱',
    'let count = 0;',
    '',
    'function increment() {',
    '  count += 1;',
    '  return count;',
    '}',
    '',
    'console.log(increment());',
    'console.log(increment());',
  ].join('\n'),
  'styles.css': ['body {', '  margin: 0;', '  font-family: system-ui, sans-serif;', '}', '', '.counter {', '  font-size: 2rem;', '}'].join('\n'),
});
