/**
 * The small audit trail a completion lesson writes for its right-hand panel:
 * the request preview, the request that left the program, the JSON that came
 * back, the assistant message, the token usage, each SSE chunk and the stream
 * summary.
 *
 * It is a file inside the run's private VFS directory, read once after the run
 * and then thrown away with the directory. Nothing here is persisted in the
 * session, and the API key is masked before a line is ever written.
 */
export const TRACE_KINDS = [
  'preview',
  'request',
  'response',
  'assistant',
  'usage',
  'chunk',
  'stream',
  'error',
] as const;

export type TraceKind = (typeof TRACE_KINDS)[number];

export interface TraceEvent {
  kind: TraceKind;
  data: unknown;
}

/** A runaway program must not build an unbounded message to the page. */
export const MAX_TRACE_EVENTS = 400;
/** Roughly half a megabyte of JSON — enough for every non-chunk event. */
export const MAX_TRACE_BYTES = 512 * 1024;

/** Kinds a panel needs; when the cap bites, chunks go first. */
const PRIORITY_KINDS: TraceKind[] = ['preview', 'request', 'response', 'assistant', 'usage', 'stream', 'error'];

const isKind = (value: unknown): value is TraceKind => TRACE_KINDS.includes(value as TraceKind);

/**
 * Keeps the newest events, but never drops the request, response, usage or
 * error that explain what happened — only chunks are expendable.
 */
export function limitTrace(events: TraceEvent[], limit = MAX_TRACE_EVENTS): TraceEvent[] {
  if (events.length <= limit) return events;
  const priority = events.filter((event) => PRIORITY_KINDS.includes(event.kind));
  const rest = events.filter((event) => !PRIORITY_KINDS.includes(event.kind));
  const room = Math.max(0, limit - priority.length);
  // `slice(-0)` is `slice(0)`: with no room left it returned every chunk, not none.
  const keptChunks = room === 0 ? [] : rest.slice(-room);
  return [...priority, ...keptChunks].sort((a, b) => events.indexOf(a) - events.indexOf(b));
}

/**
 * The byte half of the cap: chunk events compete for the budget, while the
 * request, response, usage and error stay even when one of them is large.
 */
export function capTraceBytes(events: TraceEvent[], maxBytes = MAX_TRACE_BYTES): TraceEvent[] {
  const kept: TraceEvent[] = [];
  let total = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    let size = 2;
    try {
      size = JSON.stringify(event).length + 1;
    } catch {
      size = 2;
    }
    const priority = PRIORITY_KINDS.includes(event.kind);
    if (!priority && total + size > maxBytes) continue;
    kept.push(event);
    total += size;
  }
  return kept.reverse();
}

/**
 * Reads JSON Lines, skipping a partial last line or anything malformed. Every
 * line is read before the caps apply: a program that streamed more chunks than
 * the event budget still lands its final response, usage and stream summary,
 * and only the excess chunks are dropped (`limitTrace` / `capTraceBytes`).
 */
export function parseTrace(text: string, limit = MAX_TRACE_EVENTS): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { kind?: unknown; data?: unknown };
      if (parsed && isKind(parsed.kind)) events.push({ kind: parsed.kind, data: parsed.data });
    } catch {
      /* a line cut short by a stopped run is not an event */
    }
  }
  return capTraceBytes(limitTrace(events, limit));
}

/** Trusts only the shape, for trace arrays that crossed the worker boundary. */
export function sanitizeTrace(value: unknown, limit = MAX_TRACE_EVENTS): TraceEvent[] {
  if (!Array.isArray(value)) return [];
  const events: TraceEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { kind?: unknown; data?: unknown };
    if (isKind(record.kind)) events.push({ kind: record.kind, data: record.data });
  }
  return capTraceBytes(limitTrace(events, limit));
}

/** `sk-abc…wxyz`, or bullets when the key is short. */
export function maskKey(key: string): string {
  const value = key.trim();
  if (!value) return '(empty)';
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

/**
 * Replaces the key (and any bearer token) wherever it appears. Exported so the
 * worker can mask stdout/stderr/errors/deltas before they leave for the page,
 * not just the trace.
 */
export const redactText = (text: string, secret: string, masked = maskKey(secret)): string => {
  let next = secret ? text.split(secret).join(masked) : text;
  // A provider need not echo the key verbatim; mask any bearer token as well.
  next = next.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${masked}`);
  return next;
};

/**
 * Masks a stream as it grows. A key split across SSE deltas is only visible in
 * the concatenation, so the caller must show `push()`'s full result rather than
 * appending the pieces: the key is caught once its last character arrives, and
 * the whole text is recomputed masked.
 */
export class StreamRedactor {
  private raw = '';

  constructor(private readonly secret: string) {}

  push(piece: string): string {
    this.raw += piece;
    return redactText(this.raw, this.secret);
  }

  /** What a panel should show when it only has the individual pieces. */
  static join(pieces: readonly string[], secret: string): string {
    return redactText(pieces.join(''), secret);
  }
}

const redactValue = (value: unknown, secret: string, masked: string): unknown => {
  if (typeof value === 'string') return redactText(value, secret, masked);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secret, masked));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // A JSON key can carry the secret too: mask both halves of the pair.
      out[redactText(key, secret, masked)] = redactValue(item, secret, masked);
    }
    return out;
  }
  return value;
};

/**
 * A second line of defence behind the Python-side masking: no string that
 * equals the key, and no bearer token, reaches the panel. The input is copied —
 * the session's trace is never mutated.
 */
export function redactTrace(events: readonly TraceEvent[], secret: string): TraceEvent[] {
  const trimmed = secret.trim();
  if (!trimmed) return events.map((event) => ({ kind: event.kind, data: event.data }));
  const masked = maskKey(trimmed);
  return events.map((event) => ({ kind: event.kind, data: redactValue(event.data, trimmed, masked) }));
}

/** Masks every textual field of a run before it crosses the worker boundary. */
export function redactRunText<T extends { stdout: string; stderr: string; error?: string }>(run: T, secret: string): T {
  if (!secret.trim()) return run;
  const masked = maskKey(secret);
  return {
    ...run,
    stdout: redactText(run.stdout, secret, masked),
    stderr: redactText(run.stderr, secret, masked),
    error: run.error === undefined ? undefined : redactText(run.error, secret, masked),
  };
}
