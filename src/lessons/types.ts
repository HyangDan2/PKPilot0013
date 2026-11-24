/**
 * The shape of a lesson. A lesson lives in one markdown file under
 * `src/lessons/`: the frontmatter describes the sandbox it needs (runtime, panel
 * slots, starting files, missions) and the body is the reading material the
 * learner sees in the left pane. The IDE shell itself is written once and
 * reusable — a new lesson is a new `.md` file, not a new screen.
 */

export type RuntimeId = 'python' | 'git';

/** Panel slots the right column can assemble. */
export type PanelId = 'output' | 'completion' | 'git-graph' | 'working-tree';

export type Localized = { ko: string; en: string };

/** Mock or live: a completion lesson runs offline by default. */
export type CompletionMode = 'mock' | 'live';

/**
 * The connection fields a completion lesson starts with. They are lesson data,
 * not user data: the learner's API key is entered in the panel and kept only in
 * memory, never in the lesson, the session or a saved file.
 */
export interface CompletionDefaults {
  mode: CompletionMode;
  baseUrl: string;
  model: string;
  system: string;
  user: string;
}

export type CheckSpec =
  | { type: 'ran' }
  | { type: 'stdout-contains'; value: string }
  | { type: 'stdout-matches'; value: string }
  | { type: 'stdout-lines'; values: string[] }
  | { type: 'file-contains'; path?: string; value: string }
  | { type: 'file-matches'; path?: string; value: string }
  | { type: 'git-init' }
  | { type: 'git-commits'; min: number }
  | { type: 'git-branch'; name: string }
  | { type: 'git-merge' }
  | { type: 'git-remote'; name?: string }
  | { type: 'git-push'; remote?: string; branch?: string }
  | { type: 'all'; checks: CheckSpec[] };

export interface LessonMission {
  id: string;
  title: Localized;
  goal: Localized;
  hint: Localized;
  check: CheckSpec;
}

export interface Lesson {
  id: string;
  title: Localized;
  subtitle: Localized;
  level: Localized;
  runtime: RuntimeId;
  /** File opened first when the lesson loads. */
  entry: string;
  panels: PanelId[];
  order: number;
  files: Record<string, string>;
  missions: LessonMission[];
  /** Markdown body below the frontmatter — the lesson material. */
  body: string;
  /** Per-lesson run limit, in ms. Falls back to the runtime's own 20 s. */
  runTimeoutMs?: number;
  /** Connection defaults for a lesson that talks to a chat completion API. */
  completion?: CompletionDefaults;
}

/** The live state a mission check is evaluated against. */
export interface LessonState {
  runtime: RuntimeId;
  files: Record<string, string>;
  active: string;
  runs: number;
  stdout: string;
  stderr: string;
  history: string[];
  lastCommand: string;
  gitInitialized: boolean;
  gitTotalCommits: number;
  gitMergeCommits: number;
  gitBranch: string | null;
  gitBranches: { name: string; sha: string | null; ahead?: number }[];
  gitMainTip: string | null;
  /** Remotes the learner registered — a virtual `origin` in this page. */
  gitRemotes: { name: string; url: string }[];
  /**
   * Remote-tracking branches, with `contained` telling whether their work is
   * already part of the local branch of the same name.
   */
  gitRemoteBranches: { ref: string; remote: string; branch: string; sha: string | null; contained: boolean }[];
  /** Fast-forward merges — real merges that create no merge commit. */
  gitFastForwards: number;
}
