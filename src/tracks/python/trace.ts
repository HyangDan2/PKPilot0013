/**
 * The small audit trail a completion lesson writes for its right-hand panel:
 * the request that left the program, the JSON that came back, the assistant
 * message, the token usage and each SSE chunk.
 *
 * It is a file inside the run's private VFS directory, read once after the run
 * and then thrown away with the directory. Nothing here is persisted in the
 * session, and the API key is masked before a line is ever written.
 */
export const TRACE_KINDS = ['request', 'response', 'assistant', 'usage', 'chunk', 'error'] as const;

export type TraceKind = (typeof TRACE_KINDS)[number];

export interface TraceEvent {
  kind: TraceKind;
  data: unknown;
}

/** A runaway program must not build an unbounded message to the page. */
export const MAX_TRACE_EVENTS = 400;

const isKind = (value: unknown): value is TraceKind => TRACE_KINDS.includes(value as TraceKind);

/** Reads JSON Lines, skipping a partial last line or anything malformed. */
export function parseTrace(text: string, limit = MAX_TRACE_EVENTS): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const line of text.split('\n')) {
    if (events.length >= limit) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { kind?: unknown; data?: unknown };
      if (parsed && isKind(parsed.kind)) events.push({ kind: parsed.kind, data: parsed.data });
    } catch {
      /* a line cut short by a stopped run is not an event */
    }
  }
  return events;
}

/** Trusts only the shape, for trace arrays that crossed the worker boundary. */
export function sanitizeTrace(value: unknown, limit = MAX_TRACE_EVENTS): TraceEvent[] {
  if (!Array.isArray(value)) return [];
  const events: TraceEvent[] = [];
  for (const item of value.slice(0, limit)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { kind?: unknown; data?: unknown };
    if (isKind(record.kind)) events.push({ kind: record.kind, data: record.data });
  }
  return events;
}

/** `sk-abc…wxyz`, or bullets when the key is short. */
export function maskKey(key: string): string {
  const value = key.trim();
  if (!value) return '(empty)';
  if (value.length <= 8) return '•'.repeat(value.length);
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

const redactText = (text: string, secret: string, masked: string): string => {
  let next = secret ? text.split(secret).join(masked) : text;
  // A provider need not echo the key verbatim; mask any bearer token as well.
  next = next.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${masked}`);
  return next;
};

const redactValue = (value: unknown, secret: string, masked: string): unknown => {
  if (typeof value === 'string') return redactText(value, secret, masked);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secret, masked));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactValue(item, secret, masked);
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
  const masked = maskKey(trimmed);
  return events.map((event) => ({ kind: event.kind, data: redactValue(event.data, trimmed, masked) }));
}
