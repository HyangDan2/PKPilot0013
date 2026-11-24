/**
 * The connection settings a completion lesson keeps in React state.
 *
 * The API key lives here and nowhere else: it is not part of `Session`, it is
 * not written by `writeSavedSession`, and it is not part of a lesson file. Each
 * run hands the settings to the worker as environment variables; the worker
 * clears them again when the run ends.
 */
import type { CompletionMode, Lesson } from '../lessons/types';

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
    LLM_BASE_URL: settings.baseUrl.trim(),
    LLM_API_KEY: settings.apiKey,
    LLM_MODEL: settings.model.trim(),
    LLM_SYSTEM: settings.system,
    LLM_USER: settings.user,
  };
}
