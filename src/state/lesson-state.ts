/**
 * What a mission check is allowed to see.
 *
 * A Python program's output only describes the source it was produced from. If
 * the learner edits the editor after a run, the old stdout must stop counting:
 * otherwise a mission could be awarded for a program that no longer exists on
 * screen. `sourceHash()` is that link — it is stored with the run, and the
 * lesson state compares it with the files as they are *now*.
 */
import type { Lesson, LessonState } from '../lessons/types';
import { gitFields } from '../lessons/state';
import type { RunOutput, Session } from './session';

/** A short, stable fingerprint of every lesson file (paths and contents). */
export function sourceHash(files: Record<string, string>): string {
  let hash = 2166136261;
  for (const path of Object.keys(files).sort()) {
    // The separators keep `a: 1` / `ab:` from colliding with `a: 1b`.
    for (const unit of `${path}\u0000${files[path]}\u0000`) {
      hash ^= unit.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** true when this run was produced from exactly the files on screen now. */
export function isRunCurrent(run: RunOutput | null, files: Record<string, string>): boolean {
  return !!run && run.ok === true && run.sourceHash === sourceHash(files);
}

export function lessonState(lesson: Lesson, session: Session): LessonState {
  const snap = lesson.runtime === 'git' ? session.gitSnap : null;
  const current = isRunCurrent(session.lastRun, session.files);
  return {
    runtime: lesson.runtime,
    files: session.files,
    active: session.active,
    runs: session.runs,
    // A stdout whose source has since changed is not evidence of anything.
    stdout: current ? session.lastStdout : '',
    stderr: current ? session.lastStderr : '',
    history: session.history,
    lastCommand: session.lastCmd,
    ...gitFields(snap),
  };
}
