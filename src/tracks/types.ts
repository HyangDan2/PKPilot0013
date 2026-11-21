/** Shared vocabulary for the sandbox terminals. */

/** The execution environments a lesson can declare. */
export type RuntimeId = 'python' | 'git';

export type Tone =
  | 'plain'
  | 'dim'
  | 'ok'
  | 'err'
  | 'warn'
  | 'accent'
  | 'path'
  | 'dir'
  | 'file'
  | 'exec'
  | 'branch'
  | 'sha'
  | 'add'
  | 'del';

export interface Span {
  text: string;
  tone?: Tone;
}

export interface OutLine {
  text: string;
  tone?: Tone;
  spans?: Span[];
}

export interface CommandResult {
  lines: OutLine[];
  exit: number;
  clear?: boolean;
}

export const out = (text: string, tone?: Tone): OutLine => ({ text, tone });

export const mix = (...parts: (Span | string)[]): OutLine => {
  const spans: Span[] = parts.map((part) => (typeof part === 'string' ? { text: part } : part));
  return { text: spans.map((s) => s.text).join(''), spans };
};

export const blank = (): OutLine => ({ text: '' });

export const result = (lines: OutLine[], exit = 0): CommandResult => ({ lines, exit });

export const fail = (lines: OutLine[]): CommandResult => ({ lines, exit: 1 });
