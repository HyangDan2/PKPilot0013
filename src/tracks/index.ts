/**
 * Runtime settings the IDE shell needs — prompt, quick-command chips, and the
 * terminal's own language. Everything lesson-specific (files, missions, panel
 * slots) comes from the lesson markdown instead.
 */
import type { RuntimeId } from './types';

export interface RuntimeConfig {
  id: RuntimeId;
  label: string;
  prompt: string;
  /** Commands offered as one-tap chips on touch layouts. */
  chips: string[];
  /** Files the terminal itself can write to. */
  terminalWritesFiles: boolean;
}

export const RUNTIMES: Record<RuntimeId, RuntimeConfig> = {
  python: {
    id: 'python',
    label: 'Python',
    prompt: 'learner@codeplayground:~/lesson$',
    chips: ['python main.py', 'ls', 'clear'],
    terminalWritesFiles: true,
  },
  git: {
    id: 'git',
    label: 'Git',
    prompt: 'learner@codeplayground:~/work$',
    chips: ['git status', 'git add .', 'git commit -m "첫 커밋"', 'git log --oneline', 'git switch -c feature'],
    terminalWritesFiles: true,
  },
};
