/**
 * One lesson ↔ one live sandbox. The engines live in refs, the session carries
 * files, terminal history and mission progress, and every command re-evaluates
 * the lesson's mission checks — the same wiring for every lesson, whatever
 * runtime and panel slots its markdown declared.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RUNTIMES } from '../tracks';
import { GitRepo } from '../tracks/git/repo';
import { pythonStatus, runPython, type PythonProgress } from '../tracks/python/runner';
import type { CommandResult, OutLine, RuntimeId } from '../tracks/types';
import { out } from '../tracks/types';
import { evaluateCheck } from '../lessons/checks';
import { gitFields } from '../lessons/state';
import type { Lesson, LessonState } from '../lessons/types';
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
  missionIndex: number;
  hintOpen: boolean;
  free: boolean;
  runs: number;
  lastCmd: string;
  lastStdout: string;
  lastStderr: string;
  lastRun: RunOutput | null;
  gitSnap: ReturnType<GitRepo['snapshot']> | null;
}

export interface Toast {
  ids?: string[];
  text?: string;
}

let entryId = 1;
const nextId = () => {
  entryId += 1;
  return entryId;
};

const progressKey = (lessonId: string) => `visna-sol:progress:${lessonId}`;

const readProgress = (lessonId: string): string[] => {
  try {
    const raw = localStorage.getItem(progressKey(lessonId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

const writeProgress = (lessonId: string, done: string[]) => {
  try {
    localStorage.setItem(progressKey(lessonId), JSON.stringify(done));
  } catch {
    /* private windows: progress is a nicety, never a requirement */
  }
};

const makeSession = (lesson: Lesson): Session => ({
  files: { ...lesson.files },
  active: lesson.entry,
  term: [],
  history: [],
  done: readProgress(lesson.id),
  missionIndex: 0,
  hintOpen: false,
  free: false,
  runs: 0,
  lastCmd: '',
  lastStdout: '',
  lastStderr: '',
  lastRun: null,
  gitSnap: null,
});

const lessonState = (lesson: Lesson, session: Session): LessonState => {
  const snap = lesson.runtime === 'git' ? session.gitSnap : null;
  return {
    runtime: lesson.runtime,
    files: session.files,
    active: session.active,
    runs: session.runs,
    stdout: session.lastStdout,
    stderr: session.lastStderr,
    history: session.history,
    lastCommand: session.lastCmd,
    ...gitFields(snap),
  };
};

export interface SandboxApi {
  lesson: Lesson;
  runtime: RuntimeId;
  session: Session;
  /** Missions plus the free-sandbox row; null while in free mode. */
  activeMission: Lesson['missions'][number] | null;
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
  resetLesson: () => void;
  clearTerminal: () => void;
  complete: (input: string) => string | null;
  selectMission: (index: number) => void;
  toggleHint: () => void;
}

export function useSandbox(lesson: Lesson, lang: Lang): SandboxApi {
  const [session, setSession] = useState<Session>(() => makeSession(lesson));
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [running, setRunning] = useState(false);
  const [pyProgress, setPyProgress] = useState<PythonProgress>({ stage: 'idle', percent: 0 });
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  const engine = useRef<GitRepo | null>(null);
  const config = RUNTIMES[lesson.runtime];

  const getGit = useCallback(() => {
    if (!engine.current) engine.current = new GitRepo({ ...lesson.files });
    return engine.current;
  }, [lesson.files]);

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

  const commit = useCallback(
    (next: Session): Session => {
      let evaluated = next;
      if (!next.free && lesson.missions.length > 0) {
        const state = lessonState(lesson, next);
        const done = [...next.done];
        const fresh: string[] = [];
        for (const mission of lesson.missions) {
          if (done.includes(mission.id)) continue;
          try {
            if (evaluateCheck(mission.check, state)) {
              done.push(mission.id);
              fresh.push(mission.id);
            }
          } catch {
            /* a check must never break the sandbox */
          }
        }
        if (fresh.length > 0) {
          notify({ ids: fresh });
          const nextTodo = lesson.missions.findIndex((mission) => !done.includes(mission.id));
          evaluated = {
            ...next,
            done,
            missionIndex: nextTodo === -1 ? lesson.missions.length : nextTodo,
            hintOpen: false,
          };
          writeProgress(lesson.id, done);
        }
      }
      sessionRef.current = evaluated;
      setSession(evaluated);
      return evaluated;
    },
    [lesson, notify],
  );

  const withGitSnapshot = useCallback(
    (next: Session): Session =>
      lesson.runtime === 'git' ? { ...next, gitSnap: getGit().snapshot() } : next,
    [lesson.runtime, getGit],
  );

  const runPythonFile = useCallback(
    async (current: Session, file: string, command: string): Promise<{ result: CommandResult; session: Session }> => {
      const code = current.files[file];
      if (code === undefined) {
        return {
          result: {
            lines: [out(`python: can't open file '${file}': [Errno 2] No such file or directory`, 'err')],
            exit: 1,
          },
          session: current,
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
            ...current,
            runs: current.runs + 1,
            lastRun: { stdout: run.stdout, stderr: run.stderr, error: run.error, ms: run.ms, path: file },
            lastStdout: run.stdout,
            lastStderr: run.stderr,
            lastCmd: command,
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
    async (current: Session, command: string): Promise<{ result: CommandResult; session: Session }> => {
      const tokens = command.trim().split(/\s+/);
      const [head, ...rest] = tokens;
      const korean = langRef.current === 'ko';
      if (head === 'python' || head === 'python3') {
        if (!rest[0]) return { result: { lines: [out('usage: python <file.py>', 'err')], exit: 1 }, session: current };
        return runPythonFile(current, rest[0], command);
      }
      if (head === 'ls') {
        return {
          result: { lines: Object.keys(current.files).sort().map((name) => out(name, 'path')), exit: 0 },
          session: current,
        };
      }
      if (head === 'cat') {
        const file = rest[0];
        if (!file || current.files[file] === undefined) {
          return { result: { lines: [out(`cat: ${file ?? ''}: No such file or directory`, 'err')], exit: 1 }, session: current };
        }
        return { result: { lines: current.files[file].split('\n').map((line) => out(line)), exit: 0 }, session: current };
      }
      if (head === 'clear') return { result: { lines: [], exit: 0, clear: true }, session: current };
      if (head === 'help') {
        return {
          result: {
            lines: korean
              ? [
                  out('python <파일.py>  파이썬 파일을 실행합니다', 'dim'),
                  out('ls                파일 목록을 보여 줍니다', 'dim'),
                  out('cat <파일>        파일 내용을 출력합니다', 'dim'),
                  out('clear             터미널을 지웁니다', 'dim'),
                ]
              : [
                  out('python <file.py>  run a Python file', 'dim'),
                  out('ls                list the lesson files', 'dim'),
                  out('cat <file>        print a file', 'dim'),
                  out('clear             clear the terminal', 'dim'),
                ],
            exit: 0,
          },
          session: current,
        };
      }
      return { result: { lines: [out(`bash: ${head}: command not found`, 'err')], exit: 127 }, session: current };
    },
    [runPythonFile],
  );

  const submit = useCallback(
    async (command: string) => {
      const text = command.trim();
      if (!text) return;
      const current = sessionRef.current;
      const echoed: TermEntry = {
        id: nextId(),
        kind: 'cmd',
        prompt: config.prompt,
        lines: text.split('\n').map((line) => out(line)),
      };
      let next: Session = { ...current, history: [...current.history, text], lastCmd: text };
      let result: CommandResult;

      if (lesson.runtime === 'git') {
        result = getGit().exec(text);
        next = { ...next, lastStdout: result.lines.map((line) => line.text).join('\n') };
      } else {
        const python = await pythonTerminal(current, text);
        result = python.result;
        next = { ...python.session, history: [...current.history, text] };
      }

      const entries: TermEntry[] = [echoed, { id: nextId(), kind: 'out', lines: result.lines }];
      next = result.clear ? { ...next, term: [] } : { ...next, term: [...next.term, ...entries].slice(-400) };
      commit(withGitSnapshot(next));
    },
    [config.prompt, lesson.runtime, getGit, pythonTerminal, commit, withGitSnapshot],
  );

  const runActive = useCallback(async () => {
    const path = sessionRef.current.active;
    if (lesson.runtime === 'git') {
      await submit('git status');
      await submit(`git diff -- ${path}`);
      return;
    }
    await submit(`python ${path}`);
  }, [lesson.runtime, submit]);

  const setFile = useCallback(
    (path: string, content: string) => {
      const current = sessionRef.current;
      if (current.files[path] === content) return;
      if (lesson.runtime === 'git') getGit().workdir[path] = content;
      commit(withGitSnapshot({ ...current, files: { ...current.files, [path]: content } }));
    },
    [lesson.runtime, getGit, commit, withGitSnapshot],
  );

  const openFile = useCallback((path: string) => {
    const current = sessionRef.current;
    if (!(path in current.files)) return;
    sessionRef.current = { ...current, active: path };
    setSession(sessionRef.current);
  }, []);

  const createFile = useCallback(
    (path: string) => {
      const current = sessionRef.current;
      const clean = path.trim().replace(/^\/+/, '');
      if (!clean || current.files[clean] !== undefined) return;
      if (lesson.runtime === 'git') getGit().workdir[clean] = '';
      commit(withGitSnapshot({ ...current, files: { ...current.files, [clean]: '' }, active: clean }));
    },
    [lesson.runtime, getGit, commit, withGitSnapshot],
  );

  const deleteFile = useCallback(
    (path: string) => {
      const current = sessionRef.current;
      if (Object.keys(current.files).length <= 1) return;
      const files = { ...current.files };
      delete files[path];
      const active = current.active === path ? Object.keys(files)[0] : current.active;
      if (lesson.runtime === 'git') {
        delete getGit().workdir[path];
        delete getGit().index[path];
      }
      commit(withGitSnapshot({ ...current, files, active }));
    },
    [lesson.runtime, getGit, commit, withGitSnapshot],
  );

  const resetFiles = useCallback(() => {
    engine.current = lesson.runtime === 'git' ? new GitRepo({ ...lesson.files }) : null;
    const current = sessionRef.current;
    commit(
      withGitSnapshot({
        ...current,
        files: { ...lesson.files },
        active: lesson.entry,
        runs: 0,
        lastRun: null,
        lastStdout: '',
        lastStderr: '',
        lastCmd: '',
        gitSnap: null,
      }),
    );
    notify({
      text: langRef.current === 'ko' ? '강의 파일을 처음 상태로 되돌렸습니다' : 'Lesson files are back to their starting state',
    });
  }, [lesson, commit, withGitSnapshot, notify]);

  const resetLesson = useCallback(() => {
    engine.current = lesson.runtime === 'git' ? new GitRepo({ ...lesson.files }) : null;
    writeProgress(lesson.id, []);
    commit(withGitSnapshot({ ...makeSession(lesson), done: [] }));
    notify({
      text: langRef.current === 'ko' ? '이 강의를 처음부터 다시 시작합니다' : 'This lesson started over from the beginning',
    });
  }, [lesson, commit, withGitSnapshot, notify]);

  const clearTerminal = useCallback(() => {
    sessionRef.current = { ...sessionRef.current, term: [] };
    setSession(sessionRef.current);
  }, []);

  const complete = useCallback(
    (line: string) => {
      const current = sessionRef.current;
      const trimmed = line.replace(/\s+$/, '');
      const tokens = trimmed.split(/\s+/);
      const last = tokens[tokens.length - 1] ?? '';
      const substitute = (candidate: string) => {
        const next = [...tokens];
        next[next.length - 1] = candidate;
        return next.join(' ');
      };
      if (lesson.runtime === 'git') {
        const subs = [
          'init', 'status', 'add', 'commit', 'branch', 'switch', 'checkout', 'merge', 'rebase',
          'reset', 'log', 'diff', 'cherry-pick', 'restore', 'rm', 'show', 'help',
        ];
        if (tokens.length === 1) return last === 'g' ? 'git ' : null;
        if (tokens.length === 2) {
          const matches = subs.filter((sub) => sub.startsWith(last));
          return matches.length === 1 ? `git ${matches[0]} ` : null;
        }
        if (tokens[1] === 'switch' || tokens[1] === 'merge' || tokens[1] === 'checkout') {
          const snap = current.gitSnap;
          const names = (snap?.branches ?? []).map((branch) => branch.name).filter((name) => name.startsWith(last));
          if (names.length === 1) return substitute(names[0]);
        }
      }
      const files = Object.keys(current.files).filter((file) => file.startsWith(last));
      if (files.length === 1) return substitute(files[0]);
      return null;
    },
    [lesson.runtime],
  );

  const selectMission = useCallback(
    (index: number) => {
      const current = sessionRef.current;
      commit({ ...current, missionIndex: index, free: index >= lesson.missions.length, hintOpen: false });
    },
    [lesson.missions.length, commit],
  );

  const toggleHint = useCallback(() => {
    const current = sessionRef.current;
    sessionRef.current = { ...current, hintOpen: !current.hintOpen };
    setSession(sessionRef.current);
  }, []);

  const runtime = lesson.runtime;
  const free = session.free || session.missionIndex >= lesson.missions.length;
  const activeMission = free ? null : lesson.missions[session.missionIndex] ?? null;

  return useMemo(
    () => ({
      lesson,
      runtime,
      session,
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
      resetLesson,
      clearTerminal,
      complete,
      selectMission,
      toggleHint,
    }),
    [
      lesson, runtime, session, activeMission, running, pyProgress, toast, submit, runActive, setFile,
      openFile, createFile, deleteFile, resetFiles, resetLesson, clearTerminal, complete, selectMission, toggleHint,
    ],
  );
}
