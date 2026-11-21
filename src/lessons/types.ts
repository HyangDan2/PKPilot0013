/**
 * The shape of a lesson. A lesson lives in one markdown file under
 * `src/lessons/`: the frontmatter describes the sandbox it needs (runtime, panel
 * slots, starting files, missions) and the body is the reading material the
 * learner sees in the left pane. The IDE shell itself is written once and
 * reusable — a new lesson is a new `.md` file, not a new screen.
 */

export type RuntimeId = 'python' | 'git';

/** Panel slots the right column can assemble. */
export type PanelId = 'output' | 'git-graph' | 'working-tree';

export type Localized = { ko: string; en: string };

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
  gitBranches: { name: string; sha: string | null }[];
  gitMainTip: string | null;
}
