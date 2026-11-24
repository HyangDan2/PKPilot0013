/**
 * QA for the chat completion lesson, run against the local interpreter:
 * the mock API, response parsing, SSE chunk parsing, the eight mission checks
 * and the promise that the API key never lands in the trace.
 *
 * Pyodide speaks the same Python 3; a real run here catches a lesson that would
 * fail in class. Live HTTP itself is exercised in the Playwright suite against
 * a local OpenAI-compatible server.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateCheck } from '../src/lessons/checks';
import { lessonById } from '../src/lessons';
import type { Lesson, LessonState } from '../src/lessons/types';
import { parseTrace, type TraceEvent } from '../src/tracks/python/trace';

const lesson = lessonById('chat-completion') as Lesson;
const KEY = 'sk-test-SECRET-123456';

const hasPython = (() => {
  try {
    execFileSync('python3', ['-c', 'print(1)'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

const baseState = (
  code: string,
  stdout: string,
  files: Record<string, string> = {},
  traceText = '',
): LessonState => ({
  runtime: 'python',
  files: { ...lesson.files, 'main.py': code, ...files },
  active: 'main.py',
  runs: 1,
  stdout,
  stderr: '',
  // The real JSONL the run would have left behind, read the same way the app reads it.
  trace: parseTrace(traceText),
  history: ['python main.py'],
  lastCommand: 'python main.py',
  gitInitialized: false,
  gitTotalCommits: 0,
  gitMergeCommits: 0,
  gitBranch: null,
  gitBranches: [],
  gitMainTip: null,
  gitRemotes: [],
  gitRemoteBranches: [],
  gitFastForwards: 0,
});

const passes = (missionId: string, state: LessonState) =>
  evaluateCheck(lesson.missions.find((mission) => mission.id === missionId)!.check, state);

interface Sandbox {
  stdout: string;
  trace: string;
}

/** Writes the lesson's client into a temp dir and executes one program. */
const execute = (code: string, entry = 'main.py'): Sandbox => {
  const dir = mkdtempSync(join(tmpdir(), 'pk13-chat-'));
  try {
    writeFileSync(join(dir, 'llm_client.py'), `${lesson.files['llm_client.py']}\n`, 'utf8');
    writeFileSync(join(dir, 'chatbot.py'), `${lesson.files['chatbot.py']}\n`, 'utf8');
    writeFileSync(join(dir, entry), `${code}\n`, 'utf8');
    const tracePath = join(dir, '.trace.jsonl');
    const stdout = execFileSync('python3', [entry], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        LLM_MODE: 'mock',
        LLM_BASE_URL: '',
        LLM_API_KEY: KEY,
        LLM_MODEL: 'classroom-mock-1',
        LLM_SYSTEM: '너는 친절한 파이썬 선생님이야.',
        LLM_USER: '안녕! 너는 누구야?',
        CP_TRACE_PATH: tracePath,
      },
    });
    let trace = '';
    try {
      trace = readFileSync(tracePath, 'utf8');
    } catch {
      trace = '';
    }
    return { stdout, trace };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Wraps top-level `await` snippets so CPython can run them outside Pyodide. */
const asyncProgram = (body: string): string =>
  ['import asyncio', 'async def main():', ...body.trim().split('\n').map((line) => `    ${line}`), '', 'asyncio.run(main())'].join('\n');

const requestCode = asyncProgram(`
from llm_client import build_request, default_messages
import json

request = build_request(default_messages(), temperature=0.7, max_tokens=200)
print("method:", request["method"])
print("url:", request["url"])
print(json.dumps(request["headers"], ensure_ascii=False, indent=2))
print(json.dumps(request["body"], ensure_ascii=False, indent=2))
`);

const firstCallCode = asyncProgram(`
from llm_client import chat, default_messages

response = await chat(default_messages())
message = response["choices"][0]["message"]
print("assistant:", message["content"])
`);

const responseCode = asyncProgram(`
from llm_client import chat, default_messages

response = await chat(default_messages(), temperature=0.2, max_tokens=200)
choice = response["choices"][0]
print("role:", choice["message"]["role"])
print("finish_reason:", choice["finish_reason"])
print("content:", choice["message"]["content"])
print("usage:", response["usage"])
`);

const rolesCode = asyncProgram(`
from llm_client import chat

messages = [
    {"role": "system", "content": "너는 초등학생에게 설명하는 선생님이야."},
    {"role": "user", "content": "안녕! 너는 누구야?"},
]
first = await chat(messages)
messages.append(first["choices"][0]["message"])
messages.append({"role": "user", "content": "방금 뭐라고 했어?"})
second = await chat(messages)
print("second turn:", second["choices"][0]["message"]["content"])
`);

const parametersCode = asyncProgram(`
from llm_client import chat

messages = [{"role": "user", "content": "LLM 앱에서 API 키는 어디에 두어야 해?"}]
response = await chat(messages, temperature=0.2, max_tokens=5)
choice = response["choices"][0]
print("temperature: 0.2, max_tokens: 5")
print("finish_reason:", choice["finish_reason"])
print("content:", choice["message"]["content"])
`);

const streamCode = asyncProgram(`
from llm_client import default_messages, stream_chat

response = await stream_chat(default_messages(), temperature=0.3, max_tokens=120)
chunks = response["chunks"]
content = response["choices"][0]["message"]["content"]
print("stream chunks:", len(chunks))
print("assistant:", content)
`);

const chatbotCode = asyncProgram(`
from llm_client import stream_chat

messages = [
    {"role": "system", "content": "너는 초등학생에게 설명하는 선생님이야."},
    {"role": "user", "content": "안녕! 너는 누구야?"},
]

first = await stream_chat(messages)
messages.append(first["choices"][0]["message"])
messages.append({"role": "user", "content": "방금 뭐라고 했어?"})

second = await stream_chat(messages)
messages.append(second["choices"][0]["message"])
messages.append({"role": "user", "content": "고마워!"})

third = await stream_chat(messages)
print("[chatbot]", third["choices"][0]["message"]["content"])
`);

describe.skipIf(!hasPython)('chat completion lesson, executed for real', () => {
  it('compiles every starting file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pk13-chat-'));
    try {
      for (const [name, content] of Object.entries(lesson.files)) {
        writeFileSync(join(dir, name), `${content}\n`, 'utf8');
      }
      execFileSync('python3', ['-m', 'py_compile', 'llm_client.py', 'main.py', 'http_direct.py', 'chatbot.py'], {
        cwd: dir,
        stdio: 'pipe',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts in Mock Mode and never puts the API key in the trace', () => {
    const { stdout, trace } = execute(lesson.files['main.py']);
    expect(stdout).toContain('mode: mock');
    expect(stdout).toContain('base url: mock://classroom');
    expect(stdout).toContain('model: classroom-mock-1');
    expect(stdout).toContain('api key: sk-t••••3456');
    expect(passes('chat-settings', baseState(lesson.files['main.py'], stdout))).toBe(true);

    // The mock program makes no request, so a request trace only appears when
    // one is made; the secret must not be in it either way.
    const { trace: callTrace } = execute(firstCallCode);
    expect(callTrace).not.toContain(KEY);
    expect(callTrace).toContain('Bearer sk-t••••3456');
    const events = callTrace.trim().split('\n').map((line) => JSON.parse(line) as { kind: string });
    // build_request records the preview, then chat records the actual send.
    expect(events.map((event) => event.kind)).toEqual(['preview', 'request', 'response', 'assistant', 'usage']);
    expect(trace).toBe('');
  });

  it('builds the request JSON the second mission reads', () => {
    const { stdout, trace } = execute(requestCode);
    expect(stdout).toContain('"messages"');
    expect(stdout).toContain('"temperature": 0.7');
    expect(stdout).toContain('"max_tokens": 200');
    expect(passes('chat-request', baseState(requestCode, stdout, {}, trace))).toBe(true);
    // A preview is not a send: building the request must not fabricate a request event.
    const kinds = trace.trim().split('\n').map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(kinds).toEqual(['preview']);
  });

  it('calls the mock and parses its response, usage and roles', () => {
    const first = execute(firstCallCode);
    expect(first.stdout).toContain('assistant: 선생님: 안녕하세요!');
    expect(passes('chat-first-call', baseState(firstCallCode, first.stdout, {}, first.trace))).toBe(true);

    const parsed = execute(responseCode);
    expect(parsed.stdout).toContain('role: assistant');
    expect(parsed.stdout).toContain('finish_reason: stop');
    expect(parsed.stdout).toContain('total_tokens');
    expect(passes('chat-response', baseState(responseCode, parsed.stdout, {}, parsed.trace))).toBe(true);
  });

  it('keeps the conversation on the second turn', () => {
    const { stdout, trace } = execute(rolesCode);
    expect(stdout).toContain('2번째 턴');
    expect(stdout).toContain('선생님:');
    expect(passes('chat-roles', baseState(rolesCode, stdout, {}, trace))).toBe(true);
  });

  it('makes max_tokens cut the answer and sets finish_reason to length', () => {
    const { stdout, trace } = execute(parametersCode);
    expect(stdout).toContain('finish_reason: length');
    expect(trace).toContain('"max_tokens": 5');
    expect(trace).toContain('"temperature": 0.2');
    expect(passes('chat-parameters', baseState(parametersCode, stdout, {}, trace))).toBe(true);
  });

  it('assembles streaming chunks into the same assistant message', () => {
    const { stdout, trace } = execute(streamCode);
    expect(stdout).toMatch(/stream chunks: \d+/);
    expect(stdout).toContain('assistant:');
    const kinds = trace.trim().split('\n').map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(kinds.filter((kind) => kind === 'chunk').length).toBeGreaterThan(1);
    expect(kinds).toContain('stream');
    expect(kinds).toContain('response');
    expect(passes('chat-stream', baseState(streamCode, stdout, {}, trace))).toBe(true);

    const request = trace
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind: string; data: { body?: Record<string, unknown> } })
      .find((event) => event.kind === 'request');
    expect(request?.data.body?.stream).toBe(true);
  });

  it('parses SSE data lines, keepalives and [DONE]', () => {
    const code = [
      'import json',
      'from llm_client import parse_sse_line',
      'cases = [',
      '    parse_sse_line(\'data: {"choices": [{"delta": {"content": "hi"}}]}\'),',
      '    parse_sse_line("data: [DONE]"),',
      '    parse_sse_line(": keepalive"),',
      '    parse_sse_line("data: not-json"),',
      ']',
      'print(json.dumps(cases, ensure_ascii=False))',
    ].join('\n');
    const { stdout } = execute(code);
    expect(JSON.parse(stdout.trim())).toEqual([
      { choices: [{ delta: { content: 'hi' } }] },
      'DONE',
      null,
      null,
    ]);
  });

  it('passes the free-practice chatbot mission after three turns', () => {
    const { stdout, trace } = execute(chatbotCode, 'chatbot.py');
    expect(stdout).toContain('[chatbot]');
    expect(stdout).toContain('3번째 턴');
    const finished = baseState(lesson.files['main.py'], stdout, { 'chatbot.py': chatbotCode }, trace);
    expect(passes('chat-chatbot', finished)).toBe(true);
  });

  it('does not award the later missions for the starting program', () => {
    const stdout = execute(lesson.files['main.py']).stdout;
    const starter = baseState(lesson.files['main.py'], stdout);
    for (const id of ['chat-request', 'chat-first-call', 'chat-response', 'chat-roles', 'chat-parameters', 'chat-stream', 'chat-chatbot']) {
      expect(passes(id, starter), id).toBe(false);
    }
  });

  it('streams the same finish_reason and token budget as the plain response', () => {
    const code = asyncProgram(`
import json
from llm_client import chat, default_messages, stream_chat

plain = await chat(default_messages(), max_tokens=8)
stream = await stream_chat(default_messages(), max_tokens=8)
print("SUMMARY", json.dumps({
    "plain_finish": plain["choices"][0]["finish_reason"],
    "stream_finish": stream["choices"][0]["finish_reason"],
    "plain_content": plain["choices"][0]["message"]["content"],
    "stream_content": stream["choices"][0]["message"]["content"],
    "completion_tokens": plain["usage"]["completion_tokens"],
    "chunks": len(stream["chunks"]),
}, ensure_ascii=False))
`);
    const { stdout, trace } = execute(code);
    const summary = JSON.parse(stdout.trim().split('\n').at(-1)!.replace(/^SUMMARY /, '')) as {
      plain_finish: string;
      stream_finish: string;
      plain_content: string;
      stream_content: string;
      completion_tokens: number;
      chunks: number;
    };
    // Both paths cut at the same max_tokens and say so the same way.
    expect(summary.plain_finish).toBe('length');
    expect(summary.stream_finish).toBe('length');
    expect(summary.stream_content).toBe(summary.plain_content);
    expect(summary.plain_content.endsWith('…')).toBe(true);
    // The ellipsis is inside the budget, and usage agrees with it.
    expect(summary.completion_tokens).toBeLessThanOrEqual(8);
    expect(summary.chunks).toBeGreaterThan(1);

    const events = trace
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind: string; data: Record<string, unknown> });
    const streamed = events.filter((event) => event.kind === 'stream').at(-1);
    expect(streamed?.data.finishReason).toBe('length');
    expect(streamed?.data.chunks).toBe(summary.chunks);
    const answer = events.filter((event) => event.kind === 'response').at(-1);
    const answerData = answer?.data as unknown as { choices: { message: { content: string } }[] };
    expect(answerData.choices[0].message.content).toBe(summary.stream_content);
  });

  it('keeps the response, usage and stream summary after the Python trace cap', () => {
    const code = asyncProgram(`
import llm_client
llm_client.TRACE_MAX_EVENTS = 6
await llm_client.stream_chat(llm_client.default_messages(), max_tokens=200)
`);
    const { trace } = execute(code);
    const events = trace
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { kind: string; data: Record<string, unknown> });
    const kinds = events.map((event) => event.kind);
    // The cap dropped the excess chunks, not the events that explain the run.
    expect(kinds).toContain('response');
    expect(kinds).toContain('usage');
    expect(kinds).toContain('stream');
    const chunkLines = kinds.filter((kind) => kind === 'chunk').length;
    expect(chunkLines).toBeGreaterThan(0);
    const streamed = events.find((event) => event.kind === 'stream')!;
    expect(streamed.data.done).toBe(true);
    // The summary counts what really streamed, not just the lines that survived.
    expect(Number(streamed.data.chunks)).toBeGreaterThan(chunkLines);
    expect(parseTrace(trace).map((event) => event.kind)).toContain('stream');
  });
});

/** The trace checks, fed hand-made events: no interpreter needed. */
describe('chat completion trace checks', () => {
  const event = (kind: TraceEvent['kind'], data: unknown): TraceEvent => ({ kind, data });
  const system = { role: 'system', content: '너는 선생님이야.' };
  const firstAsk = { role: 'user', content: '안녕' };
  const secondAsk = { role: 'user', content: '방금 뭐라고 했어?' };
  const answer = '첫 번째 답입니다.';

  const requestEvent = (messages: { role: string; content: string }[]) =>
    event('request', { body: { model: 'm', messages } });
  const responseEvent = (content: string, extra: Record<string, unknown> = {}) =>
    event('response', {
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      ...extra,
    });
  const rolesFiles = { ...lesson.files, 'main.py': 'messages.append(first["choices"][0]["message"])\nrole = "system"\n' };
  const stateWith = (trace: TraceEvent[], files: Record<string, string> = rolesFiles): LessonState => ({
    ...baseState('', '', {}, ''),
    files,
    trace,
  });

  it('awards the multi-turn mission only when the answer is replayed verbatim', () => {
    const good = stateWith([
      requestEvent([system, firstAsk]),
      responseEvent(answer),
      requestEvent([system, firstAsk, { role: 'assistant', content: answer }, secondAsk]),
      responseEvent('두 번째 답'),
    ]);
    expect(passes('chat-roles', good)).toBe(true);

    const paraphrased = stateWith([
      requestEvent([system, firstAsk]),
      responseEvent(answer),
      requestEvent([system, firstAsk, { role: 'assistant', content: '첫 번째 답입니다' }, secondAsk]),
      responseEvent('두 번째 답'),
    ]);
    expect(passes('chat-roles', paraphrased)).toBe(false);

    const forgotten = stateWith([
      requestEvent([system, firstAsk]),
      responseEvent(answer),
      requestEvent([system, secondAsk]),
      responseEvent('두 번째 답'),
    ]);
    expect(passes('chat-roles', forgotten)).toBe(false);
  });

  it('counts only requests that were answered', () => {
    const withFailure = stateWith([
      requestEvent([system, firstAsk]),
      event('error', { status: 500, message: 'provider down' }),
      requestEvent([system, firstAsk]),
      responseEvent(answer),
      requestEvent([system, firstAsk, { role: 'assistant', content: answer }, secondAsk]),
      responseEvent('두 번째 답'),
    ]);
    // Two successful turns — the failed attempt does not count, but neither
    // does it break the conversation that followed.
    expect(passes('chat-roles', withFailure)).toBe(true);
  });

  it('does not block a live answer for a missing usage or a different finish_reason', () => {
    const responseFiles = { ...lesson.files, 'main.py': 'choice = response["choices"][0]\n' };
    const noUsage = stateWith(
      [requestEvent([{ role: 'user', content: 'hi' }]), responseEvent('답', { finish_reason: 'length' })],
      responseFiles,
    );
    expect(passes('chat-response', noUsage)).toBe(true);

    const oddUsage = stateWith(
      [
        requestEvent([{ role: 'user', content: 'hi' }]),
        responseEvent('답', { usage: { note: 'not counted' } }),
      ],
      responseFiles,
    );
    expect(passes('chat-response', oddUsage)).toBe(false);

    const goodUsage = stateWith(
      [
        requestEvent([{ role: 'user', content: 'hi' }]),
        responseEvent('답', { usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }),
      ],
      responseFiles,
    );
    expect(passes('chat-response', goodUsage)).toBe(true);
  });
});
