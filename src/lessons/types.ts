/**
 * The shape of a lesson. A lesson lives in one markdown file under
 * `src/lessons/`: the frontmatter describes the sandbox it needs (runtime, panel
 * slots, starting files, missions) and the body is the reading material the
 * learner sees in the left pane. The IDE shell itself is written once and
 * reusable — a new lesson is a new `.md` file, not a new screen.
 */

import type { TraceEvent } from '../tracks/python/trace';

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

/**
 * Trace checks judge what the program actually sent and received, not the
 * words a particular mock happens to return. The same declarations pass in
 * Mock Mode and against a real OpenAI-compatible provider.
 */
export interface TraceRequestCheck {
  type: 'trace-request';
  /** The call must be a real send (false: a preview may satisfy it). */
  sent?: boolean;
  messages?: string[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  model?: string;
  authorization?: 'masked' | 'absent' | 'any';
  /** Minimum number of requests seen (multi-turn). */
  minTurns?: number;
  /** Some earlier assistant message must be reused before the last user turn. */
  assistantReuse?: boolean;
}

export interface TracePreviewCheck {
  type: 'trace-preview';
  messages?: string[];
  temperature?: number;
  maxTokens?: number;
}

export interface TraceResponseCheck {
  type: 'trace-response';
  finish?: 'stop' | 'length';
  usage?: boolean;
  assistant?: boolean;
}

export interface TraceStreamCheck {
  type: 'trace-stream';
  minChunks?: number;
  done?: boolean;
  assistant?: boolean;
}

export interface TraceTurnsCheck {
  type: 'trace-turns';
  min: number;
  assistantReuse?: boolean;
}

export type CheckSpec =
  | { type: 'ran' }
  | { type: 'stdout-contains'; value: string }
  | { type: 'stdout-matches'; value: string }
  | { type: 'stdout-lines'; values: string[] }
  | { type: 'file-contains'; path?: string; value: string }
  | { type: 'file-matches'; path?: string; value: string }
  | TraceRequestCheck
  | TracePreviewCheck
  | TraceResponseCheck
  | TraceStreamCheck
  | TraceTurnsCheck
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
  /** The current run's request/response trail, when the lesson produced one. */
  trace: TraceEvent[];
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
