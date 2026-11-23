/**
 * One lesson ↔ one live sandbox.
 *
 * The engines live in refs, the session carries files, terminal history and
 * mission progress, and every command re-evaluates the lesson's mission checks —
 * the same wiring for every lesson, whatever runtime and panel slots its
 * markdown declared.
 *
 * Three rules keep the two halves honest:
 *  - After any Git command the editor is re-projected from the repository's working
 *    tree (see `projectGit`), so a branch switch really changes the file you see.
 *  - A Python run is applied only if it is still the run the learner is waiting
 *    for; restarting the lesson, switching away or pressing Stop invalidates it.
 *  - Every change is saved, and the lesson reopens where it was left.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RUNTIMES } from '../tracks';
import { GitRepo } from '../tracks/git/repo';
import {
  disposePython,
  cancelPython,
  pythonStatus,
  runPython,
  type PythonProgress,
} from '../tracks/python/runner';
import type { CommandResult, OutLine, RuntimeId } from '../tracks/types';
import { out } from '../tracks/types';
import { evaluateCheck } from '../lessons/checks';
import { lessonState, sourceHash } from './lesson-state';
import { t, type Lang } from '../i18n';
import type { Lesson } from '../lessons/types';
import {
  bootstrapSession,
  clearSavedSession,
  projectGit,
  readSavedSession,
  subscribeToSessionChanges,
  writeSavedSession,
  type SaveConflict,
  type Session,
  type TermEntry,
} from './session';

export type { RunOutput, Session, TermEntry } from './session';

export interface Toast {
  ids?: string[];
  text?: string;
}

let entryId = 1;
const nextId = () => {
  entryId += 1;
  return entryId;
};

/** How long a program may take before its worker is killed. */
const RUN_TIMEOUT_MS = 20_000;
/** How long the runtime may take to fetch and start before we give up on it. */
const LOAD_TIMEOUT_MS = 30_000;

/**
 * Mission checks see the last run only when that run finished cleanly *and* the
 * files it ran are still the files on screen: a crash, a SyntaxError, a stop, or
 * an edit made after the run is not "my program worked".
 */

export interface SandboxApi {
  lesson: Lesson;
  runtime: RuntimeId;
  session: Session;
  /** Missions plus the free-sandbox row; null while in free mode. */
  activeMission: Lesson['missions'][number] | null;
  completed: string[];
  running: boolean;
  pyProgress: PythonProgress;
  /** true when the last run's source no longer matches the editor. */
  staleRun: boolean;
  toast: Toast | null;
  /** Another tab saved a newer copy while this one has unsaved work. */
  syncConflict: SaveConflict | null;
  /** Resolves that conflict: keep this tab's work, or load the other tab's. */
  resolveSync: (choice: 'mine' | 'theirs') => void;
  submit: (command: string) => Promise<void>;
  runActive: () => Promise<void>;
  stopRun: () => void;
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
  const boot = useRef<{ session: Session; repo: GitRepo | null; revision: number } | null>(null);
  if (boot.current === null) boot.current = bootstrapSession(lesson);

  const [session, setSession] = useState<Session>(boot.current.session);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [pyProgress, setPyProgress] = useState<PythonProgress>({ stage: 'idle', percent: 0 });
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  const engine = useRef<GitRepo | null>(boot.current.repo);
  /** The stored revision this tab is working from — bumped by every write. */
  const revision = useRef(boot.current.revision);
  /** Signature of the last state this tab saved, to tell "unsaved work" apart. */
  const savedSignature = useRef<string>(signature(boot.current.session, boot.current.repo));
  const [syncConflict, setSyncConflict] = useState<SaveConflict | null>(null);
  /** Bumped whenever the lesson is restarted, so late results are dropped. */
  const generation = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const config = RUNTIMES[lesson.runtime];

  const getGit = useCallback(() => {
    if (!engine.current) engine.current = new GitRepo({ ...sessionRef.current.files });
    return engine.current;
  }, []);

  const notify = useCallback((message: Toast) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);

  const persist = useCallback(
    (next: Session, force = false) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      const repo = lesson.runtime === 'git' ? engine.current : null;
      saveTimer.current = window.setTimeout(() => {
        const result = writeSavedSession(lesson.id, next, repo, {
          baseRevision: revision.current,
          force,
        });
        if (result.ok) {
          revision.current = result.revision;
          savedSignature.current = signature(next, repo);
          setSyncConflict(null);
        } else {
          // Someone else's newer copy stays untouched until the learner decides.
          setSyncConflict(result.conflict);
        }
      }, 200);
    },
    [lesson.id, lesson.runtime],
  );

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      // Leaving the lesson stops a program that is still running.
      generation.current += 1;
      disposePython();
      const last = sessionRef.current;
      // Leaving the tab saves only what it is allowed to: a newer copy in
      // another tab is not overwritten by a tab that is closing.
      writeSavedSession(lesson.id, last, lesson.runtime === 'git' ? engine.current : null, {
        baseRevision: revision.current,
      });
    },
    [lesson.id, lesson.runtime],
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
        }
      }
      sessionRef.current = evaluated;
      setSession(evaluated);
      persist(evaluated);
      return evaluated;
    },
    [lesson, notify, persist],
  );

  const withGitSnapshot = useCallback(
    (next: Session): Session =>
      lesson.runtime === 'git' ? { ...next, gitSnap: getGit().snapshot() } : next,
    [lesson.runtime, getGit],
  );

  /** Rebuilds this tab from the stored copy — the other tab's newer state. */
  const adoptSaved = useCallback((): boolean => {
    const saved = readSavedSession(lesson.id);
    if (!saved) return false;
    const restored = lesson.runtime === 'git' ? GitRepo.fromState(saved.git) : null;
    const files = restored ? { ...restored.workdir } : { ...saved.files };
    if (runningRef.current) cancelPython();
    generation.current += 1; // a run started from the old files is no longer wanted
    runningRef.current = false;
    setRunning(false);
    engine.current = restored;
    const active = saved.active in files ? saved.active : Object.keys(files).sort()[0] ?? '';
    const next: Session = {
      ...sessionRef.current,
      files,
      active,
      done: saved.done,
      missionIndex: Math.min(Math.max(0, saved.missionIndex), lesson.missions.length),
      free: saved.free || saved.missionIndex >= lesson.missions.length,
      lastRun: null,
      lastStdout: '',
      lastStderr: '',
      gitSnap: restored ? restored.snapshot() : null,
    };
    revision.current = saved.revision;
    savedSignature.current = signature(next, restored);
    sessionRef.current = next;
    setSession(next);
    setSyncConflict(null);
    return true;
  }, [lesson.id, lesson.missions.length, lesson.runtime]);

  // Another tab saved. If this tab holds unsaved work, its own save is stopped
  // and the learner is asked; if it holds nothing new, it simply follows along.
  useEffect(() => {
    const unsubscribe = subscribeToSessionChanges(lesson.id, (change) => {
      if (change.revision <= revision.current) return;
      const repo = lesson.runtime === 'git' ? engine.current : null;
      if (signature(sessionRef.current, repo) === savedSignature.current) {
        if (adoptSaved()) notify({ text: t(langRef.current, 'syncAdopted') });
        return;
      }
      setSyncConflict({ revision: change.revision, updatedAt: change.updatedAt });
    });
    return unsubscribe;
  }, [lesson.id, lesson.runtime, adoptSaved, notify]);

  const resolveSync = useCallback(
    (choice: 'mine' | 'theirs') => {
      if (choice === 'mine') {
        notify({ text: t(langRef.current, 'syncKept') });
        persist(sessionRef.current, true);
        return;
      }
      if (adoptSaved()) notify({ text: t(langRef.current, 'syncDropped') });
    },
    [adoptSaved, notify, persist],
  );

  /** Working tree → editor. Called after every Git command. */
  const syncFromGit = useCallback(
    (next: Session): Session => {
      if (lesson.runtime !== 'git') return next;
      const repo = getGit();
      const projected = projectGit(repo, next.active);
      return { ...next, files: projected.files, active: projected.active, gitSnap: repo.snapshot() };
    },
    [lesson.runtime, lesson.entry, getGit],
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
      if (runningRef.current) {
        return {
          result: { lines: [out(langRef.current === 'ko' ? '이미 실행 중입니다. 끝나거나 중단될 때까지 기다려 주세요.' : 'A program is already running — wait for it to finish or press Stop.', 'warn')], exit: 1 },
          session: current,
        };
      }
      const generationAtStart = generation.current;
      const hashAtStart = sourceHash(current.files);
      runningRef.current = true;
      setRunning(true);
      const poll = window.setInterval(() => setPyProgress({ ...pythonStatus() }), 200);
      try {
        const run = await runPython(code, current.files, file, {
          timeoutMs: RUN_TIMEOUT_MS,
          loadTimeoutMs: LOAD_TIMEOUT_MS,
        });
        setPyProgress({ ...pythonStatus() });
        if (generationAtStart !== generation.current) {
          // The learner restarted the lesson while this program was running.
          return { result: { lines: [], exit: 0 }, session: current };
        }
        const lines: OutLine[] = [];
        if (run.stdout) run.stdout.split('\n').forEach((line) => lines.push(out(line)));
        if (run.stderr) run.stderr.split('\n').forEach((line) => lines.push(out(line, 'err')));
        if (run.error === 'cancelled') {
          lines.push(out(langRef.current === 'ko' ? '실행을 중단했습니다.' : 'Run stopped.', 'warn'));
        } else if (run.error === 'load-timeout') {
          lines.push(
            out(
              langRef.current === 'ko'
                ? `Python 런타임을 ${LOAD_TIMEOUT_MS / 1000}초 안에 불러오지 못했습니다. 연결을 확인하고 다시 실행해 주세요. (프로그램은 아직 실행되지 않았습니다)`
                : `The Python runtime did not load within ${LOAD_TIMEOUT_MS / 1000}s. Check the connection and run again — your program has not run yet.`,
              'warn',
            ),
          );
        } else if (run.error === 'timeout') {
          lines.push(out(langRef.current === 'ko' ? `실행 시간이 ${RUN_TIMEOUT_MS / 1000}초를 넘어 중단했습니다.` : `Stopped after ${RUN_TIMEOUT_MS / 1000}s.`, 'warn'));
        } else if (run.error === 'busy') {
          lines.push(out(langRef.current === 'ko' ? '이미 실행 중입니다.' : 'Already running.', 'warn'));
        } else if (run.error) {
          run.error.split('\n').forEach((line) => lines.push(out(line, 'err')));
        }
        lines.push(out(`— ${run.ms} ms`, 'dim'));
        return {
          result: { lines, exit: run.ok ? 0 : 1 },
          session: {
            ...current,
            // A run that raised or was stopped is not progress.
            runs: run.ok ? current.runs + 1 : current.runs,
            lastRun: {
              stdout: run.stdout,
              stderr: run.stderr,
              error: run.error,
              ms: run.ms,
              path: file,
              ok: run.ok,
              cancelled: run.stoppedBy === 'user',
              timedOut: run.stoppedBy === 'timeout',
              phase: run.phase,
              loadMs: run.loadMs,
              // Which source this output belongs to — a later edit makes it stale.
              sourceHash: hashAtStart,
            },
            lastStdout: run.stdout,
            lastStderr: run.stderr,
            lastCmd: command,
          },
        };
      } finally {
        window.clearInterval(poll);
        runningRef.current = false;
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
      const generationAtStart = generation.current;
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
        // The command may have rewritten the working tree (switch, merge, reset,
        // restore, rm) — the editor follows it immediately.
        next = syncFromGit({ ...next, lastStdout: result.lines.map((line) => line.text).join('\n') });
      } else {
        const python = await pythonTerminal(current, text);
        if (generationAtStart !== generation.current) return;
        result = python.result;
        // The learner may have typed in the editor while the program was running,
        // so the files come from the session as it is now — only the run's own
        // results are taken from the snapshot the run started with.
        const latest = sessionRef.current;
        next = {
          ...latest,
          runs: python.session.runs,
          lastRun: python.session.lastRun,
          lastStdout: python.session.lastStdout,
          lastStderr: python.session.lastStderr,
          history: [...latest.history, text],
          lastCmd: text,
        };
      }

      const entries: TermEntry[] = [echoed, { id: nextId(), kind: 'out', lines: result.lines }];
      next = result.clear ? { ...next, term: [] } : { ...next, term: [...next.term, ...entries].slice(-400) };
      commit(next);
    },
    [config.prompt, lesson.runtime, getGit, pythonTerminal, commit, syncFromGit],
  );

  const runActive = useCallback(async () => {
    if (runningRef.current) return;
    const path = sessionRef.current.active;
    if (lesson.runtime === 'git') {
      await submit('git status');
      await submit(`git diff -- ${path}`);
      return;
    }
    await submit(`python ${path}`);
  }, [lesson.runtime, submit]);

  const stopRun = useCallback(() => {
    if (!runningRef.current) return;
    if (!cancelPython()) return;
    // Anything the stopped run would have reported is no longer wanted.
    generation.current += 1;
    runningRef.current = false;
    setRunning(false);
    const current = sessionRef.current;
    const note: TermEntry = {
      id: nextId(),
      kind: 'note',
      lines: [out(langRef.current === 'ko' ? '실행을 중단했습니다.' : 'Run stopped.', 'warn')],
    };
    commit({
      ...current,
      term: [...current.term, note].slice(-400),
      lastRun: {
        stdout: '',
        stderr: '',
        error: 'cancelled',
        ms: 0,
        path: current.active,
        ok: false,
        cancelled: true,
      },
    });
  }, [commit]);

  const setFile = useCallback(
    (path: string, content: string) => {
      const current = sessionRef.current;
      // With no open file there is nothing to edit — the learner creates one first.
      if (!path || current.files[path] === content) return;
      if (lesson.runtime === 'git') getGit().workdir[path] = content;
      const files = repositoryFiles(lesson.runtime, getGit, { ...current.files, [path]: content });
      commit(withGitSnapshot({ ...current, files }));
    },
    [lesson.runtime, getGit, commit, withGitSnapshot],
  );

  const openFile = useCallback(
    (path: string) => {
      const current = sessionRef.current;
      if (!(path in current.files)) return;
      const next = { ...current, active: path };
      sessionRef.current = next;
      setSession(next);
      persist(next);
    },
    [persist],
  );

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
      const active = current.active === path ? Object.keys(files).sort()[0] : current.active;
      if (lesson.runtime === 'git') {
        delete getGit().workdir[path];
        delete getGit().index[path];
      }
      commit(withGitSnapshot({ ...current, files, active }));
    },
    [lesson.runtime, getGit, commit, withGitSnapshot],
  );

  const restartEngine = useCallback(() => {
    generation.current += 1;
    if (runningRef.current) cancelPython();
    runningRef.current = false;
    setRunning(false);
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    engine.current = lesson.runtime === 'git' ? new GitRepo({ ...lesson.files }) : null;
  }, [lesson.files, lesson.runtime]);

  const resetFiles = useCallback(() => {
    restartEngine();
    const current = sessionRef.current;
    const files = { ...lesson.files };
    commit(
      withGitSnapshot({
        ...current,
        files,
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
  }, [lesson, commit, withGitSnapshot, notify, restartEngine]);

  const resetLesson = useCallback(() => {
    restartEngine();
    clearSavedSession(lesson.id);
    revision.current = 0;
    savedSignature.current = '';
    setSyncConflict(null);
    const fresh = bootstrapSession(lesson).session;
    commit(withGitSnapshot({ ...fresh, term: [], history: [], done: [], missionIndex: 0, free: false, runs: 0, lastRun: null }));
    notify({
      text: langRef.current === 'ko' ? '이 강의를 처음부터 다시 시작합니다' : 'This lesson started over from the beginning',
    });
  }, [lesson, commit, withGitSnapshot, notify, restartEngine]);

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
          'remote', 'push', 'fetch', 'pull',
        ];
        if (tokens.length === 1) return last === 'g' ? 'git ' : null;
        if (tokens.length === 2) {
          const matches = subs.filter((sub) => sub.startsWith(last));
          return matches.length === 1 ? `git ${matches[0]} ` : null;
        }
        if (tokens[1] === 'remote' && tokens.length === 3) {
          const actions = ['add', 'remove', 'set-url', '-v'].filter((action) => action.startsWith(last));
          return actions.length === 1 ? substitute(actions[0]) : null;
        }
        if (tokens[1] === 'switch' || tokens[1] === 'merge' || tokens[1] === 'checkout') {
          const branchNames = (current.gitSnap?.branches ?? []).map((branch) => branch.name).filter((name) => name.startsWith(last));
          if (branchNames.length === 1) return substitute(branchNames[0]);
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
  const staleRun =
    runtime === 'python' && session.lastRun?.ok === true && session.lastRun.sourceHash !== sourceHash(session.files);

  return useMemo(
    () => ({
      lesson,
      runtime,
      session,
      activeMission,
      completed: session.done,
      running,
      pyProgress,
      staleRun,
      toast,
      syncConflict,
      resolveSync,
      submit,
      runActive,
      stopRun,
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
      lesson, runtime, session, activeMission, running, pyProgress, staleRun, toast, syncConflict, resolveSync, submit,
      runActive, stopRun, setFile, openFile, createFile, deleteFile, resetFiles, resetLesson, clearTerminal, complete,
      selectMission, toggleHint,
    ],
  );
}

/** For a Git lesson the working tree wins over an editor-side file map. */
function repositoryFiles(runtime: RuntimeId, getGit: () => GitRepo, files: Record<string, string>) {
  return runtime === 'git' ? { ...getGit().workdir } : files;
}

/** What "this tab has unsaved work" means: everything a save would write. */
function signature(session: Session, repo: GitRepo | null): string {
  return JSON.stringify({
    files: session.files,
    active: session.active,
    done: session.done,
    missionIndex: session.missionIndex,
    free: session.free,
    git: repo ? repo.serialize() : null,
  });
}
