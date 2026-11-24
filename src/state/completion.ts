/**
 * The connection settings a completion lesson keeps in React state.
 *
 * The API key lives here and nowhere else: it is not part of `Session`, it is
 * not written by `writeSavedSession`, and it is not part of a lesson file. Each
 * run hands the settings to the worker as environment variables; the worker
 * clears them again when the run ends. Mock Mode never receives the key at all.
 */
import type { CompletionMode, Lesson } from '../lessons/types';
import type { RunConfigSnapshot } from './session';

export interface CompletionSettings {
  mode: CompletionMode;
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
}

export function initialCompletion(lesson: Lesson): CompletionSettings | null {
  if (!lesson.completion) return null;
  return {
    mode: lesson.completion.mode,
    baseUrl: lesson.completion.baseUrl,
    apiKey: '',
    model: lesson.completion.model,
    system: lesson.completion.system,
    user: lesson.completion.user,
  };
}

/** The environment the lesson's Python client reads at import time. */
export function completionEnv(settings: CompletionSettings): Record<string, string> {
  return {
    LLM_MODE: settings.mode,
    LLM_BASE_URL: settings.mode === 'mock' ? '' : settings.baseUrl.trim(),
    // Mock Mode has no use for a key, so it is not even handed to the worker.
    LLM_API_KEY: settings.mode === 'mock' ? '' : settings.apiKey,
    LLM_MODEL: settings.model.trim(),
    LLM_SYSTEM: settings.system,
    LLM_USER: settings.user,
  };
}

/** Fingerprint of everything except the key, for the run snapshot. */
export function completionHash(settings: CompletionSettings): string {
  const material = [settings.mode, settings.baseUrl.trim(), settings.model.trim(), settings.system, settings.user].join('\u0000');
  let hash = 2166136261;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function runConfigSnapshot(settings: CompletionSettings, revision: number): RunConfigSnapshot {
  return {
    mode: settings.mode,
    baseUrl: settings.baseUrl,
    model: settings.model,
    system: settings.system,
    user: settings.user,
    hash: completionHash(settings),
    revision,
  };
}

/** true when the output was produced with exactly the settings in the panel. */
export function configMatches(run: RunConfigSnapshot | undefined, settings: CompletionSettings, revision: number): boolean {
  if (!run) return false;
  return run.revision === revision && run.hash === completionHash(settings);
}
