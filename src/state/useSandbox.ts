/**
 * The one place where the four sandboxes are wired to the UI: engines live in
 * refs, each track keeps its own session (files, terminal history, missions),
 * and every command re-evaluates the mission checks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { TRACKS, TRACK_ORDER } from '../tracks';
import { GitRepo } from '../tracks/git/repo';
import { Shell } from '../tracks/linux/shell';
import { SqlSandbox, defaultSqlFactory, isSqlError, type SqlResult, type SqlTable } from '../tracks/sql/db';
import {
  gitMissions,
  linuxMissions,
  pythonMissions,
  sqlMissions,
  type GitMissionState,
  type LinuxMissionState,
  type PythonMissionState,
  type SqlMissionState,
} from '../tracks/missions';
import { pythonStatus, runPython, type PythonProgress } from '../tracks/python/runner';
import type { CommandResult, Mission, OutLine, TrackId } from '../tracks/types';
import { out } from '../tracks/types';
import type { Lang } from '../i18n';

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
}

export interface Session {
  files: Record<string, string>;
  active: string;
  term: TermEntry[];
  history: string[];
  done: string[];
  runs: number;
  lastStdout: string;
  lastStderr: string;
  lastCommand: string;
  missionIndex: number;
  hintOpen: boolean;
  free: boolean;
  gitSnap: GitMissionState | null;
  linuxSnap: { tree: LinuxMissionState['tree']; cwd: string; prompt: string } | null;
  sqlTables: SqlTable[];
  sqlLast: SqlResult | null;
  lastRun: RunOutput | null;
}

let entryId = 1;
const nextId = () => {
  entryId += 1;
  return entryId;
};

const initialSession = (id: TrackId): Session => {
  const config = TRACKS[id];
  const files = config.files();
  return {
    files,
    active: config.entry,
    term: [],
    history: [],
    done: [],
    runs: 0,
    lastStdout: '',
    lastStderr: '',
    lastCommand: '',
    missionIndex: 0,
    hintOpen: false,
    free: false,
    gitSnap: null,
    linuxSnap: null,
    sqlTables: [],
    sqlLast: null,
    lastRun: null,
  };
};

const initialSessions = (): Record<TrackId, Session> => ({
  git: initialSession('git'),
  python: initialSession('python'),
  linux: initialSession('linux'),
  sql: initialSession('sql'),
});

const MISSIONS: Record<TrackId, Mission<never>[]> = {
  git: gitMissions as unknown as Mission<never>[],
  python: pythonMissions as unknown as Mission<never>[],
  linux: linuxMissions as unknown as Mission<never>[],
  sql: sqlMissions as unknown as Mission<never>[],
};

export const missionsOf = (id: TrackId) => MISSIONS[id];

const PROGRESS_KEY = 'visna-sol:progress';

const readProgress = (): Partial<Record<TrackId, string[]>> => {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<TrackId, string[]>>) : {};
  } catch {
    return {};
  }
};

const writeProgress = (sessions: Record<TrackId, Session>) => {
  try {
    const payload: Partial<Record<TrackId, string[]>> = {};
    for (const id of TRACK_ORDER) payload[id] = sessions[id].done;
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(payload));
  } catch {
    /* storage can be unavailable in private windows — progress is a nicety */
  }
};

const buildMissionState = (id: TrackId, session: Session) => {
  switch (id) {
    case 'git':
      return session.gitSnap as unknown as GitMissionState;
    case 'linux':
      return {
        tree: session.linuxSnap?.tree ?? [],
        cwd: session.linuxSnap?.cwd ?? '/home/learner/work',
        history: session.history,
        lastCommand: session.lastCommand,
        lastStdout: session.lastStdout,
      } as LinuxMissionState;
    case 'python':
      return {
        files: session.files,
        activePath: session.active,
        lastStdout: session.lastRun?.stdout ?? '',
        lastStderr: session.lastRun?.stderr ?? '',
        runs: session.runs,
      } as PythonMissionState;
    case 'sql':
      return {
        tables: session.sqlTables,
        last: session.sqlLast,
        lastSql: session.lastCommand,
      } as SqlMissionState;
  }
};

export interface Toast {
  ids?: string[];
  text?: string;
}

export interface SandboxApi {
  track: TrackId;
  setTrack: (id: TrackId) => void;
  session: Session;
  missions: Mission<never>[];
  activeMission: Mission<never> | null;
  completed: string[];
  running: boolean;
  pyProgress: PythonProgress;
  toast: Toast | null;
  submit: (command: string) => Promise<void>;
  runActive: () => Promise<void>;
  setFile: (path: string, content: string) => void;
  openFile: (path: string) => void;
  createFile: (path: string) => void;
  deleteFile: (path: string) => void;
  resetFiles: () => void;
  resetTrack: () => void;
  clearTerminal: () => void;
  complete: (input: string) => string | null;
  selectMission: (index: number) => void;
  toggleHint: () => void;
  completeFree: (on: boolean) => void;
}

export function useSandbox(lang: Lang): SandboxApi {
  const [track, setTrackState] = useState<TrackId>('git');
  const [sessions, setSessionsState] = useState<Record<TrackId, Session>>(() => {
    const base = initialSessions();
    const stored = readProgress();
    for (const id of TRACK_ORDER) base[id].done = stored[id] ?? [];
    return base;
  });
  const sessionsRef = useRef(sessions);
  const [running, setRunning] = useState(false);
  const [pyProgress, setPyProgress] = useState<PythonProgress>({ stage: 'idle', percent: 0 });
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  const engines = useRef<{ git: GitRepo | null; linux: Shell | null; sql: SqlSandbox | null }>({
    git: null,
    linux: null,
    sql: null,
  });

  const setSessions = useCallback((updater: (current: Record<TrackId, Session>) => Record<TrackId, Session>) => {
    const next = updater(sessionsRef.current);
    sessionsRef.current = next;
    setSessionsState(next);
  }, []);

  const getGit = useCallback(() => {
    if (!engines.current.git) engines.current.git = new GitRepo(TRACKS.git.files());
    return engines.current.git;
  }, []);

  const getShell = useCallback(() => {
    if (!engines.current.linux) engines.current.linux = new Shell();
    return engines.current.linux;
  }, []);

  const getSql = useCallback(async () => {
    if (!engines.current.sql) engines.current.sql = new SqlSandbox(defaultSqlFactory);
    await engines.current.sql.init();
    return engines.current.sql;
  }, []);

  const notify = useCallback((message: Toast) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  /** Re-run every mission check against the session we just produced. */
  const applyProgress = useCallback(
    (id: TrackId, session: Session): Session => {
      if (session.free) return session;
      const state = buildMissionState(id, session);
      if (!state) return session;
      const missions = missionsOf(id);
      const done = [...session.done];
      const fresh: string[] = [];
      for (const mission of missions) {
        if (done.includes(mission.id)) continue;
        try {
          if ((mission.check as (value: unknown) => boolean)(state)) {
            done.push(mission.id);
            fresh.push(mission.id);
          }
        } catch {
          /* a check must never break the sandbox */
        }
      }
      if (fresh.length === 0) return session;
      notify({ ids: fresh });
      const nextTodo = missions.findIndex((mission) => !done.includes(mission.id));
      return { ...session, done, missionIndex: nextTodo === -1 ? missions.length : nextTodo, hintOpen: false };
    },
    [notify],
  );

  const commitSession = useCallback(
    (id: TrackId, session: Session) => {
      const evaluated = applyProgress(id, session);
      setSessions((current) => {
        const next = { ...current, [id]: evaluated };
        writeProgress(next);
        return next;
      });
    },
    [applyProgress, setSessions],
  );

  const refreshSnapshots = useCallback(
    (id: TrackId, session: Session): Session => {
      if (id === 'git') return { ...session, gitSnap: getGit().snapshot() };
      if (id === 'linux') return { ...session, linuxSnap: getShell().snapshot() };
      return session;
    },
    [getGit, getShell],
  );

  const sortedKeys = useCallback((files: Record<string, string>) => Object.keys(files).sort(), []);

  const resultLines = useCallback(
    (run: SqlResult): OutLine[] => {
      const korean = langRef.current === 'ko';
      if (!run.columns.length) {
        return [out(`OK · ${run.changes} ${korean ? '행 변경' : 'rows changed'} · ${run.ms} ms`, 'ok')];
      }
      const header = run.columns.join('  |  ');
      const lines: OutLine[] = [out(header, 'accent'), out('-'.repeat(Math.min(72, header.length)), 'dim')];
      for (const row of run.rows.slice(0, 12)) {
        lines.push(out(row.map((cell) => (cell === null ? 'NULL' : String(cell))).join('  |  ')));
      }
      if (run.rows.length > 12) lines.push(out(`… +${run.rows.length - 12}`, 'dim'));
      lines.push(out(`${run.rows.length} ${korean ? '행' : 'rows'} · ${run.ms} ms`, 'dim'));
      return lines;
    },
    [],
  );

  const runPythonFile = useCallback(
    async (session: Session, file: string, command: string): Promise<{ result: CommandResult; session: Session }> => {
      const code = session.files[file];
      if (code === undefined) {
        return {
          result: {
            lines: [out(`python: can't open file '${file}': [Errno 2] No such file or directory`, 'err')],
            exit: 1,
          },
          session,
        };
      }
      setRunning(true);
      const poll = window.setInterval(() => setPyProgress({ ...pythonStatus() }), 200);
      try {
        const run = await runPython(code);
        setPyProgress({ ...pythonStatus() });
        const lines: OutLine[] = [];
        if (run.stdout) run.stdout.split('\n').forEach((line) => lines.push(out(line)));
        if (run.stderr) run.stderr.split('\n').forEach((line) => lines.push(out(line, 'err')));
        if (run.error) run.error.split('\n').forEach((line) => lines.push(out(line, 'err')));
        lines.push(out(`— ${run.ms} ms`, 'dim'));
        return {
          result: { lines, exit: run.error ? 1 : 0 },
          session: {
            ...session,
            runs: session.runs + 1,
            lastRun: { stdout: run.stdout, stderr: run.stderr, error: run.error, ms: run.ms, path: file },
            lastStdout: run.stdout,
            lastStderr: run.stderr,
            lastCommand: command,
          },
        };
      } finally {
        window.clearInterval(poll);
        setRunning(false);
      }
    },
    [],
  );

  const pythonTerminal = useCallback(
    async (session: Session, command: string): Promise<{ result: CommandResult; session: Session }> => {
      const tokens = command.trim().split(/\s+/);
      const [head, ...rest] = tokens;
      if (head === 'python' || head === 'python3') {
        if (!rest[0]) return { result: { lines: [out('usage: python <file.py>', 'err')], exit: 1 }, session };
        return runPythonFile(session, rest[0], command);
      }
      if (head === 'ls') {
        return { result: { lines: sortedKeys(session.files).map((name) => out(name, 'path')), exit: 0 }, session };
      }
      if (head === 'cat') {
        const file = rest[0];
        if (!file || session.files[file] === undefined) {
          return { result: { lines: [out(`cat: ${file ?? ''}: No such file or directory`, 'err')], exit: 1 }, session };
        }
        return { result: { lines: session.files[file].split('\n').map((line) => out(line)), exit: 0 }, session };
      }
      if (head === 'clear') return { result: { lines: [], exit: 0, clear: true }, session };
      if (head === 'help') {
        return {
          result: {
            lines: [
              out('python <file.py>  파일을 실행합니다', 'dim'),
              out('ls                파일 목록을 보여 줍니다', 'dim'),
              out('cat <file>        파일 내용을 출력합니다', 'dim'),
              out('clear             터미널을 지웁니다', 'dim'),
            ],
            exit: 0,
          },
          session,
        };
      }
      return { result: { lines: [out(`bash: ${head}: command not found`, 'err')], exit: 127 }, session };
    },
    [runPythonFile, sortedKeys],
  );

  const submit = useCallback(
    async (command: string) => {
      const text = command.trim();
      if (!text) return;
      const id = track;
      const config = TRACKS[id];
      const current = sessionsRef.current[id];
      const echoed: TermEntry = {
        id: nextId(),
        kind: 'cmd',
        prompt: config.prompt,
        lines: text.split('\n').map((line) => out(line)),
      };
      let session: Session = { ...current, history: [...current.history, text], lastCommand: text };
      let result: CommandResult;
      let structured: SqlResult | null = null;

      if (id === 'git') {
        result = getGit().exec(text);
        session = { ...session, lastStdout: result.lines.map((line) => line.text).join('\n') };
      } else if (id === 'linux') {
        result = getShell().exec(text);
        session = { ...session, lastStdout: result.lines.map((line) => line.text).join('\n') };
      } else if (id === 'sql') {
        const sql = await getSql();
        if (text.startsWith('.')) {
          result = sql.exec(text);
        } else {
          const run = sql.run(text);
          if (isSqlError(run)) {
            result = { lines: [out(`Error: ${run.message}`, 'err')], exit: 1 };
          } else {
            result = { lines: resultLines(run), exit: 0 };
            structured = run;
          }
        }
        session = {
          ...session,
          lastStdout: result.lines.map((line) => line.text).join('\n'),
          sqlTables: sql.tables(),
          sqlLast: structured ?? session.sqlLast,
        };
      } else {
        const python = await pythonTerminal(session, text);
        result = python.result;
        session = python.session;
      }

      const entries: TermEntry[] = [echoed, { id: nextId(), kind: 'out', lines: result.lines }];
      session = result.clear ? { ...session, term: [] } : { ...session, term: [...session.term, ...entries].slice(-400) };
      session = refreshSnapshots(id, session);
      commitSession(id, session);
    },
    [track, getGit, getShell, getSql, pythonTerminal, refreshSnapshots, commitSession, resultLines],
  );

  const runActive = useCallback(async () => {
    const id = track;
    const config = TRACKS[id];
    const session = sessionsRef.current[id];
    const path = session.active;

    if (id === 'git') {
      await submit('git status');
      await submit(`git diff -- ${path}`);
      return;
    }
    if (id === 'linux') {
      const script = (session.files[path] ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
      for (const line of script) await submit(line);
      return;
    }
    if (id === 'sql') {
      const sql = await getSql();
      const code = session.files[path] ?? '';
      setRunning(true);
      try {
        const run = sql.run(code);
        const echoed: TermEntry = {
          id: nextId(),
          kind: 'cmd',
          prompt: config.prompt,
          lines: code.split('\n').map((line) => out(line)),
        };
        const lines = isSqlError(run) ? [out(`Error: ${run.message}`, 'err')] : resultLines(run);
        const entries: TermEntry[] = [echoed, { id: nextId(), kind: 'out', lines }];
        const next: Session = {
          ...session,
          lastCommand: code,
          lastStdout: lines.map((line) => line.text).join('\n'),
          sqlLast: isSqlError(run) ? session.sqlLast : run,
          sqlTables: sql.tables(),
          term: [...session.term, ...entries].slice(-400),
        };
        commitSession(id, next);
      } finally {
        setRunning(false);
      }
      return;
    }
    await submit(`python ${path}`);
  }, [track, submit, getSql, commitSession, resultLines]);

  const setFile = useCallback(
    (path: string, content: string) => {
      const id = track;
      const session = sessionsRef.current[id];
      if (session.files[path] === content) return;
      const next: Session = { ...session, files: { ...session.files, [path]: content } };
      if (id === 'git') getGit().workdir[path] = content;
      commitSession(id, next);
    },
    [track, commitSession, getGit],
  );

  const openFile = useCallback(
    (path: string) => {
      const id = track;
      setSessions((current) => ({ ...current, [id]: { ...current[id], active: path } }));
    },
    [track, setSessions],
  );

  const createFile = useCallback(
    (path: string) => {
      const id = track;
      const session = sessionsRef.current[id];
      const clean = path.trim().replace(/^\/+/, '');
      if (!clean || session.files[clean] !== undefined) return;
      const next: Session = { ...session, files: { ...session.files, [clean]: '' }, active: clean };
      if (id === 'git') getGit().workdir[clean] = '';
      commitSession(id, next);
    },
    [track, commitSession, getGit],
  );

  const deleteFile = useCallback(
    (path: string) => {
      const id = track;
      const session = sessionsRef.current[id];
      if (Object.keys(session.files).length <= 1) return;
      const files = { ...session.files };
      delete files[path];
      const active = session.active === path ? Object.keys(files)[0] : session.active;
      const next: Session = { ...session, files, active };
      if (id === 'git') {
        delete getGit().workdir[path];
        delete getGit().index[path];
      }
      commitSession(id, next);
    },
    [track, commitSession, getGit],
  );

  const resetEngines = useCallback((id: TrackId) => {
    if (id === 'git') engines.current.git = new GitRepo(TRACKS.git.files());
    if (id === 'linux') engines.current.linux = new Shell();
    if (id === 'sql') {
      engines.current.sql?.reset();
      engines.current.sql = null;
    }
  }, []);

  const resetFiles = useCallback(() => {
    const id = track;
    const config = TRACKS[id];
    const files = config.files();
    resetEngines(id);
    const session = sessionsRef.current[id];
    const next: Session = {
      ...session,
      files,
      active: config.entry,
      lastRun: null,
      runs: 0,
      sqlLast: null,
      sqlTables: [],
      gitSnap: null,
      linuxSnap: null,
    };
    commitSession(id, refreshSnapshots(id, next));
    notify({ text: langRef.current === 'ko' ? '파일을 처음 상태로 되돌렸습니다' : 'Files reset to their starting state' });
  }, [track, resetEngines, commitSession, refreshSnapshots, notify]);

  const resetTrack = useCallback(() => {
    const id = track;
    const config = TRACKS[id];
    const files = config.files();
    resetEngines(id);
    const fresh: Session = { ...initialSession(id), files, active: config.entry };
    commitSession(id, refreshSnapshots(id, fresh));
    notify({ text: langRef.current === 'ko' ? '트랙을 처음 상태로 되돌렸습니다' : 'Track reset to its starting state' });
  }, [track, resetEngines, commitSession, refreshSnapshots, notify]);

  const clearTerminal = useCallback(() => {
    const id = track;
    setSessions((current) => ({ ...current, [id]: { ...current[id], term: [] } }));
  }, [track, setSessions]);

  const complete = useCallback(
    (line: string) => {
      const id = track;
      const session = sessionsRef.current[id];
      if (id === 'linux') return getShell().complete(line);
      const trimmed = line.replace(/\s+$/, '');
      const tokens = trimmed.split(/\s+/);
      const last = tokens[tokens.length - 1] ?? '';
      const substitute = (candidate: string) => {
        const next = [...tokens];
        next[next.length - 1] = candidate;
        return next.join(' ');
      };
      if (id === 'git') {
        const subs = [
          'init', 'status', 'add', 'commit', 'branch', 'switch', 'checkout', 'merge', 'rebase',
          'reset', 'log', 'diff', 'cherry-pick', 'restore', 'rm', 'show', 'help',
        ];
        if (tokens.length === 1) return last === 'g' ? 'git ' : null;
        if (tokens.length === 2) {
          const matches = subs.filter((sub) => sub.startsWith(last));
          return matches.length === 1 ? `git ${matches[0]} ` : null;
        }
      }
      if (id === 'sql' && tokens.length === 1 && last.startsWith('.')) {
        const dots = ['.tables', '.schema', '.help', '.clear'];
        const matches = dots.filter((dot) => dot.startsWith(last));
        return matches.length === 1 ? matches[0] : null;
      }
      const matches = Object.keys(session.files).filter((file) => file.startsWith(last));
      if (matches.length === 1) return substitute(matches[0]);
      return null;
    },
    [track, getShell],
  );

  const selectMission = useCallback(
    (index: number) => {
      const id = track;
      const session = sessionsRef.current[id];
      commitSession(id, { ...session, missionIndex: index, free: index >= missionsOf(id).length, hintOpen: false });
    },
    [track, commitSession],
  );

  const toggleHint = useCallback(() => {
    const id = track;
    const session = sessionsRef.current[id];
    commitSession(id, { ...session, hintOpen: !session.hintOpen });
  }, [track, commitSession]);

  const completeFree = useCallback(
    (on: boolean) => {
      const id = track;
      const session = sessionsRef.current[id];
      commitSession(id, { ...session, free: on, hintOpen: false });
    },
    [track, commitSession],
  );

  const setTrack = useCallback(
    (id: TrackId) => {
      setTrackState(id);
      if (id === 'git') {
        const session = sessionsRef.current.git;
        if (!session.gitSnap) {
          setSessions((current) => ({ ...current, git: { ...current.git, gitSnap: getGit().snapshot() } }));
        }
      }
      if (id === 'linux') {
        const session = sessionsRef.current.linux;
        if (!session.linuxSnap) {
          setSessions((current) => ({ ...current, linux: { ...current.linux, linuxSnap: getShell().snapshot() } }));
        }
      }
      if (id === 'sql') {
        void getSql().then((sql) => {
          const tables = sql.tables();
          setSessions((current) => ({ ...current, sql: { ...current.sql, sqlTables: tables } }));
        });
      }
    },
    [getGit, getShell, getSql, setSessions],
  );

  const session = sessions[track];
  const missions = missionsOf(track);
  const isFree = session.free || session.missionIndex >= missions.length;
  const activeMission = isFree ? null : missions[session.missionIndex] ?? null;

  return {
    track,
    setTrack,
    session,
    missions,
    activeMission,
    completed: session.done,
    running,
    pyProgress,
    toast,
    submit,
    runActive,
    setFile,
    openFile,
    createFile,
    deleteFile,
    resetFiles,
    resetTrack,
    clearTerminal,
    complete,
    selectMission,
    toggleHint,
    completeFree,
  };
}
