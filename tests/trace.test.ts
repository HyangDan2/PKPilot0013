import { describe, expect, it } from 'vitest';
import {
  MAX_TRACE_EVENTS,
  maskKey,
  parseTrace,
  redactTrace,
  sanitizeTrace,
  type TraceEvent,
} from '../src/tracks/python/trace';

describe('completion trace', () => {
  it('reads JSON lines and skips a partial or malformed one', () => {
    const text = [
      '{"kind":"request","data":{"url":"https://example.test/v1/chat/completions"}}',
      'not json',
      '{"kind":"chunk","data":{"choices":[{"delta":{"content":"안녕"}}]}}',
      '{"kind":"unknown","data":1}',
      '{"kind":"response","data":{"choices":[]',
    ].join('\n');
    expect(parseTrace(text)).toEqual([
      { kind: 'request', data: { url: 'https://example.test/v1/chat/completions' } },
      { kind: 'chunk', data: { choices: [{ delta: { content: '안녕' } }] } },
    ]);
  });

  it('caps a runaway trace', () => {
    const line = '{"kind":"chunk","data":1}';
    expect(parseTrace(Array.from({ length: MAX_TRACE_EVENTS + 20 }, () => line).join('\n'))).toHaveLength(MAX_TRACE_EVENTS);
    expect(sanitizeTrace([{ kind: 'chunk', data: 1 }, { kind: 'nope' }, null])).toEqual([{ kind: 'chunk', data: 1 }]);
  });

  it('masks the key and bearer tokens without mutating the input', () => {
    const key = 'sk-test-SECRET-123456';
    const events: TraceEvent[] = [
      {
        kind: 'request',
        data: {
          headers: { Authorization: `Bearer ${key}` },
          body: { prompt: `my key is ${key}` },
        },
      },
      { kind: 'chunk', data: { text: `Bearer ${key}` } },
    ];
    const redacted = redactTrace(events, key);
    const dump = JSON.stringify(redacted);
    expect(dump).not.toContain(key);
    expect(dump).toContain('Bearer sk-t••••3456');
    expect(JSON.stringify(events)).toContain(key);
    expect(maskKey('')).toBe('(empty)');
    expect(maskKey('short')).toBe('•••••');
  });
});
