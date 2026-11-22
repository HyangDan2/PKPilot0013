/**
 * The React session around one live sandbox.
 *
 * Two state sources meet here and this module is the only place they do:
 *
 *  - For a **Git** lesson the repository's working tree is the source of truth.
 *    `session.files` is a projection of it (`projectGit`), rewritten after every
 *    command, so the editor, the file list and `git status` can never disagree.
 *  - For a **Python** lesson the session's files are the source of truth; running
 *    copies them into the interpreter's virtual filesystem.
 *
 * It also owns the "come back where I left off" policy: files, the active file,
 * completed missions, the current mission and — for Git — commits, branches and
 * the index are saved after every change and restored on load.
 */
import { GitRepo, type GitRepoState } from '../tracks/git/repo';
import type { Lesson } from '../lessons/types';
import type { OutLine } from '../tracks/types';

export interface TermEntry {
  id: number;
  kind: 'cmd' | 'out' | 'note';
  prompt?: string;
  lines: OutLine[];
}

export interface RunOutput {
  stdout: string;
  stderr: string;
  error?: string;
  ms: number;
  path: string;
  /** false when the program raised, hit a SyntaxError or was stopped. */
  ok: boolean;
  cancelled?: boolean;
  timedOut?: boolean;
}

export interface Session {
  files: Record<string, string>;
  active: string;
  term: TermEntry[];
  history: string[];
  done: string[];
  missionIndex: number;
  hintOpen: boolean;
  free: boolean;
  /** Successful runs only — a program that raised is not a finished mission. */
  runs: number;
  lastCmd: string;
  lastStdout: string;
  lastStderr: string;
  lastRun: RunOutput | null;
  gitSnap: ReturnType<GitRepo['snapshot']> | null;
}

export const SESSION_VERSION = 3;

const sessionKey = (lessonId: string) => `codeplayground:session:v${SESSION_VERSION}:${lessonId}`;
const legacyProgressKey = (lessonId: string) => `visna-sol:progress:${lessonId}`;

interface PersistedSession {
  version: number;
  files: Record<string, string>;
  active: string;
  done: string[];
  missionIndex: number;
  free: boolean;
  git: GitRepoState | null;
  savedAt: number;
}

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null; // private windows: saving is a nicety, never a requirement
  }
};

const isStringMap = (value: unknown): value is Record<string, string> =>
  !!value && typeof value === 'object' && Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string');

export function readSavedSession(lessonId: string): PersistedSession | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(sessionKey(lessonId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    if (parsed.version !== SESSION_VERSION) return null;
    if (!isStringMap(parsed.files) || Object.keys(parsed.files).length === 0) return null;
    if (typeof parsed.active !== 'string' || !(parsed.active in parsed.files)) return null;
    const done = Array.isArray(parsed.done) ? parsed.done.filter((id): id is string => typeof id === 'string') : [];
    return {
      version: SESSION_VERSION,
      files: parsed.files,
      active: parsed.active,
      done,
      missionIndex: Number.isFinite(parsed.missionIndex) ? Number(parsed.missionIndex) : 0,
      free: parsed.free === true,
      git: (parsed.git as GitRepoState | null) ?? null,
      savedAt: Number(parsed.savedAt ?? 0),
    };
  } catch {
    return null;
  }
}

export function writeSavedSession(lessonId: string, session: Session, repo: GitRepo | null): void {
  const store = storage();
  if (!store) return;
  const payload: PersistedSession = {
    version: SESSION_VERSION,
    files: session.files,
    active: session.active,
    done: session.done,
    missionIndex: session.missionIndex,
    free: session.free,
    git: repo ? repo.serialize() : null,
    savedAt: Date.now(),
  };
  try {
    store.setItem(sessionKey(lessonId), JSON.stringify(payload));
  } catch {
    /* a full or blocked storage must not break the lesson */
  }
}

export function clearSavedSession(lessonId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(sessionKey(lessonId));
  } catch {
    /* ignore */
  }
}

/** Progress saved by the previous build of this app (Vísna Sól) still counts. */
export function readLegacyProgress(lessonId: string): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(legacyProgressKey(lessonId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** The starting point of a lesson: restored work if there is any, else the markdown. */
export function bootstrapSession(lesson: Lesson): { session: Session; repo: GitRepo | null } {
  const saved = readSavedSession(lesson.id);
  const files = saved ? { ...saved.files } : { ...lesson.files };
  const active = saved && saved.active in files ? saved.active : lesson.entry in files ? lesson.entry : Object.keys(files).sort()[0] ?? lesson.entry;
  const done = saved ? saved.done : readLegacyProgress(lesson.id);
  const missionIndex = saved
    ? Math.min(Math.max(0, saved.missionIndex), lesson.missions.length)
    : 0;
  const repo =
    lesson.runtime === 'git'
      ? (saved ? GitRepo.fromState(saved.git) : null) ?? new GitRepo({ ...files })
      : null;
  const session: Session = {
    files: repo ? { ...repo.workdir } : files,
    active,
    term: [],
    history: [],
    done,
    missionIndex,
    hintOpen: false,
    free: saved ? saved.free || missionIndex >= lesson.missions.length : false,
    runs: 0,
    lastCmd: '',
    lastStdout: '',
    lastStderr: '',
    lastRun: null,
    gitSnap: repo ? repo.snapshot() : null,
  };
  return { session, repo };
}

/**
 * The working tree → the editor. A file that vanished (deleted, or checked out
 * from another branch) hands the editor to a file that still exists, so the
 * active path is never stale.
 */
export function projectGit(
  repo: GitRepo,
  active: string,
  entry: string,
): { files: Record<string, string>; active: string } {
  const files = { ...repo.workdir };
  if (files[active] !== undefined) return { files, active };
  const fallback = Object.keys(files).sort()[0];
  return { files, active: fallback ?? entry };
}

