import { describe, expect, it } from 'vitest';
import {
  MAX_TRACE_BYTES,
  MAX_TRACE_EVENTS,
  capTraceBytes,
  limitTrace,
  maskKey,
  parseTrace,
  redactRunText,
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

  it('keeps the preview, request, response, usage and stream under a chunk flood', () => {
    const priority: TraceEvent[] = [
      { kind: 'preview', data: { body: {} } },
      { kind: 'request', data: { body: {} } },
      { kind: 'response', data: { choices: [] } },
      { kind: 'usage', data: { total_tokens: 1 } },
      { kind: 'stream', data: { chunks: 3 } },
    ];
    const chunks: TraceEvent[] = Array.from({ length: 50 }, (_, index) => ({ kind: 'chunk', data: { index } }));
    const limited = limitTrace([...priority, ...chunks], 10);
    expect(limited).toHaveLength(10);
    expect(limited.map((event) => event.kind)).toEqual(['preview', 'request', 'response', 'usage', 'stream', ...Array(5).fill('chunk')]);
  });

  it('enforces the byte cap on chunks but never drops the final response', () => {
    const huge = { kind: 'chunk' as const, data: { text: 'x'.repeat(MAX_TRACE_BYTES) } };
    const events: TraceEvent[] = [
      huge,
      { kind: 'response', data: { choices: [{ message: { content: 'done' } }] } },
      { kind: 'usage', data: { total_tokens: 2 } },
    ];
    const capped = capTraceBytes(events);
    expect(capped.map((event) => event.kind)).toEqual(['response', 'usage']);
  });

  it('parses the new event kinds and masks run text with the run’s own key', () => {
    const text = [
      '{"kind":"preview","data":{"body":{}}}',
      '{"kind":"stream","data":{"chunks":2,"done":true}}',
      '{"kind":"assistant","data":{"content":"hi"}}',
    ].join('\n');
    expect(parseTrace(text).map((event) => event.kind)).toEqual(['preview', 'stream', 'assistant']);
    const masked = redactRunText(
      { stdout: 'key sk-test-SECRET-123456', stderr: '', error: 'bad Bearer sk-test-SECRET-123456' },
      'sk-test-SECRET-123456',
    );
    expect(masked.stdout).toBe('key sk-t••••3456');
    expect(masked.error).toBe('bad Bearer sk-t••••3456');
  });
});
