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
import type { CompletionMode, Lesson } from '../lessons/types';
import type { OutLine } from '../tracks/types';
import type { TraceEvent } from '../tracks/python/trace';

export interface TermEntry {
  id: number;
  kind: 'cmd' | 'out' | 'note';
  prompt?: string;
  lines: OutLine[];
}

/**
 * The connection settings a run was made with, minus the key. A run belongs to
 * the configuration it started with: changing the model in the panel makes the
 * old answer stale instead of quietly counting it for the new setup.
 */
export interface RunConfigSnapshot {
  mode: CompletionMode;
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  /** Fingerprint of the non-secret settings — the API key is never included. */
  hash: string;
  /** Bumped by every settings edit in this tab. */
  revision: number;
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
  /** Which limit stopped the run, or which phase failed. */
  phase?: 'load' | 'run';
  /** Time the runtime took to come up for this run. */
  loadMs?: number;
  /** Fingerprint of the files this output was produced from (see `sourceHash`). */
  sourceHash?: string;
  /** The completion settings this output belongs to; absent for other lessons. */
  config?: RunConfigSnapshot;
  /** Request/response audit trail for a completion lesson (never persisted). */
  trace?: TraceEvent[];
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
const channelName = (lessonId: string) => `codeplayground:session-sync:v${SESSION_VERSION}:${lessonId}`;

interface PersistedSession {
  version: number;
  /**
   * Bumped by every write. A tab remembers the revision it read, so a write
   * that would roll over another tab's newer save is caught instead of done.
   */
  revision: number;
  /** When the stored copy was last written (ms since the epoch). */
  updatedAt: number;
  files: Record<string, string>;
  active: string;
  done: string[];
  missionIndex: number;
  free: boolean;
  git: GitRepoState | null;
  savedAt: number;
}

/** What another tab already has, when this tab is behind it. */
export interface SaveConflict {
  revision: number;
  updatedAt: number;
}

export type SaveResult = { ok: true; revision: number; updatedAt: number } | { ok: false; conflict: SaveConflict };

/** One tab telling the others that the stored session moved on. */
export interface SessionChange {
  revision: number;
  updatedAt: number;
  /** Where the notice came from — used to skip this tab's own echo. */
  source: 'broadcast' | 'storage';
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
    if (!isStringMap(parsed.files)) return null;
    // An empty file list is a real state (every file was deleted or `git rm`-ed),
    // not a corrupt one — it must come back as it was saved.
    if (typeof parsed.active !== 'string') return null;
    if (Object.keys(parsed.files).length > 0 && !(parsed.active in parsed.files)) return null;
    const done = Array.isArray(parsed.done) ? parsed.done.filter((id): id is string => typeof id === 'string') : [];
    return {
      version: SESSION_VERSION,
      // A save written before revisions existed is revision 0 — still readable,
      // and the next write simply starts counting from there.
      revision: Number.isFinite(parsed.revision) ? Number(parsed.revision) : 0,
      updatedAt: Number.isFinite(parsed.updatedAt)
        ? Number(parsed.updatedAt)
        : Number.isFinite(parsed.savedAt)
          ? Number(parsed.savedAt)
          : 0,
      files: parsed.files,
      active: Object.keys(parsed.files).length > 0 ? parsed.active : '',
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

/** Revision of the stored copy, 0 when there is none. */
export function storedRevision(lessonId: string): number {
  return readSavedSession(lessonId)?.revision ?? 0;
}

export interface WriteOptions {
  /** The revision this tab read — a newer stored copy makes the write refuse. */
  baseRevision?: number;
  /** The learner chose to overwrite the other tab's copy. */
  force?: boolean;
}

/**
 * Saves the session unless another tab has written a newer revision than the
 * one this tab is working from. Refusing is the point: an unseen newer copy
 * must never be overwritten silently.
 */
export function writeSavedSession(
  lessonId: string,
  session: Session,
  repo: GitRepo | null,
  options: WriteOptions = {},
): SaveResult {
  const store = storage();
  const now = Date.now();
  if (!store) return { ok: true, revision: options.baseRevision ?? 0, updatedAt: now };
  const stored = readSavedSession(lessonId);
  const current = stored?.revision ?? 0;
  const base = options.baseRevision;
  if (!options.force && base !== undefined && current > base) {
    return { ok: false, conflict: { revision: current, updatedAt: stored?.updatedAt ?? 0 } };
  }
  const revision = Math.max(current, base ?? 0) + 1;
  const payload: PersistedSession = {
    version: SESSION_VERSION,
    revision,
    updatedAt: now,
    files: session.files,
    active: session.active,
    done: session.done,
    missionIndex: session.missionIndex,
    free: session.free,
    git: repo ? repo.serialize() : null,
    savedAt: now,
  };
  try {
    store.setItem(sessionKey(lessonId), JSON.stringify(payload));
  } catch {
    /* a full or blocked storage must not break the lesson */
    return { ok: true, revision, updatedAt: now };
  }
  announce(lessonId, { revision, updatedAt: now });
  return { ok: true, revision, updatedAt: now };
}

// ── telling the other tabs ──────────────────────────────────────────────────
const listeners = new Map<string, Set<(change: SessionChange) => void>>();
const channels = new Map<string, BroadcastChannel>();
let storageBound = false;

function channel(lessonId: string): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const existing = channels.get(lessonId);
  if (existing) return existing;
  try {
    const created = new BroadcastChannel(channelName(lessonId));
    created.onmessage = (event: MessageEvent) => {
      const data = event.data as Partial<SessionChange> | null;
      if (!data || typeof data.revision !== 'number') return;
      deliver(lessonId, { revision: data.revision, updatedAt: Number(data.updatedAt ?? 0), source: 'broadcast' });
    };
    channels.set(lessonId, created);
    return created;
  } catch {
    return null;
  }
}

function deliver(lessonId: string, change: SessionChange): void {
  for (const listener of [...(listeners.get(lessonId) ?? [])]) {
    try {
      listener(change);
    } catch {
      /* a listener must never break saving */
    }
  }
}

function announce(lessonId: string, change: { revision: number; updatedAt: number }): void {
  try {
    channel(lessonId)?.postMessage({ ...change, source: 'broadcast' });
  } catch {
    /* no channel: the storage event still tells the other tabs */
  }
}

/** A `storage` event carries the same news when BroadcastChannel is unavailable. */
function bindStorage(): void {
  if (storageBound || typeof window === 'undefined' || !window.addEventListener) return;
  storageBound = true;
  window.addEventListener('storage', (event: StorageEvent) => {
    if (!event.key || !event.newValue) return;
    for (const lessonId of listeners.keys()) {
      if (event.key !== sessionKey(lessonId)) continue;
      try {
        const parsed = JSON.parse(event.newValue) as Partial<PersistedSession>;
        if (typeof parsed.revision !== 'number') return;
        deliver(lessonId, {
          revision: parsed.revision,
          updatedAt: Number(parsed.updatedAt ?? parsed.savedAt ?? 0),
          source: 'storage',
        });
      } catch {
        /* someone else's key with our prefix — ignore */
      }
    }
  });
}

/** Listens for a newer stored session from another tab. Returns the unsubscribe. */
export function subscribeToSessionChanges(
  lessonId: string,
  listener: (change: SessionChange) => void,
): () => void {
  bindStorage();
  channel(lessonId);
  const set = listeners.get(lessonId) ?? new Set<(change: SessionChange) => void>();
  set.add(listener);
  listeners.set(lessonId, set);
  return () => {
    const current = listeners.get(lessonId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(lessonId);
  };
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
export function bootstrapSession(lesson: Lesson): {
  session: Session;
  repo: GitRepo | null;
  /** The stored revision this session was read from (0 when nothing was stored). */
  revision: number;
} {
  const saved = readSavedSession(lesson.id);
  const files = saved ? { ...saved.files } : { ...lesson.files };
  const active = saved && saved.active in files ? saved.active : lesson.entry in files ? lesson.entry : Object.keys(files).sort()[0] ?? '';
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
  return { session, repo, revision: saved?.revision ?? 0 };
}

/**
 * The working tree → the editor. A file that vanished (deleted, or checked out
 * from another branch) hands the editor to a file that still exists, so the
 * active path is never stale. A working tree with no files at all produces an
 * empty active path, which the editor shows as an empty workspace.
 */
export function projectGit(
  repo: GitRepo,
  active: string,
): { files: Record<string, string>; active: string } {
  const files = { ...repo.workdir };
  if (files[active] !== undefined) return { files, active };
  const fallback = Object.keys(files).sort()[0];
  if (fallback) return { files, active: fallback };
  // Nothing to open. Typing into the entry path would silently resurrect a file,
  // so the editor decides what to do instead of guessing here.
  return { files, active: '' };
}

