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

const baseState = (code: string, stdout: string, files: Record<string, string> = {}): LessonState => ({
  runtime: 'python',
  files: { ...lesson.files, 'main.py': code, ...files },
  active: 'main.py',
  runs: 1,
  stdout,
  stderr: '',
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
      execFileSync('python3', ['-m', 'py_compile', 'llm_client.py', 'main.py', 'chatbot.py'], {
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
    expect(events.map((event) => event.kind)).toEqual(['request', 'response', 'assistant', 'usage']);
    expect(trace).toBe('');
  });

  it('builds the request JSON the second mission reads', () => {
    const { stdout } = execute(requestCode);
    expect(stdout).toContain('"messages"');
    expect(stdout).toContain('"temperature": 0.7');
    expect(stdout).toContain('"max_tokens": 200');
    expect(passes('chat-request', baseState(requestCode, stdout))).toBe(true);
  });

  it('calls the mock and parses its response, usage and roles', () => {
    const first = execute(firstCallCode);
    expect(first.stdout).toContain('assistant: 선생님: 안녕하세요!');
    expect(passes('chat-first-call', baseState(firstCallCode, first.stdout))).toBe(true);

    const parsed = execute(responseCode);
    expect(parsed.stdout).toContain('role: assistant');
    expect(parsed.stdout).toContain('finish_reason: stop');
    expect(parsed.stdout).toContain('total_tokens');
    expect(passes('chat-response', baseState(responseCode, parsed.stdout))).toBe(true);
  });

  it('keeps the conversation on the second turn', () => {
    const { stdout } = execute(rolesCode);
    expect(stdout).toContain('2번째 턴');
    expect(stdout).toContain('선생님:');
    expect(passes('chat-roles', baseState(rolesCode, stdout))).toBe(true);
  });

  it('makes max_tokens cut the answer and sets finish_reason to length', () => {
    const { stdout, trace } = execute(parametersCode);
    expect(stdout).toContain('finish_reason: length');
    expect(trace).toContain('"max_tokens": 5');
    expect(trace).toContain('"temperature": 0.2');
    expect(passes('chat-parameters', baseState(parametersCode, stdout))).toBe(true);
  });

  it('assembles streaming chunks into the same assistant message', () => {
    const { stdout, trace } = execute(streamCode);
    expect(stdout).toMatch(/stream chunks: \d+/);
    expect(stdout).toContain('assistant:');
    const kinds = trace.trim().split('\n').map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(kinds.filter((kind) => kind === 'chunk').length).toBeGreaterThan(1);
    expect(kinds).toContain('response');
    expect(passes('chat-stream', baseState(streamCode, stdout))).toBe(true);

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
    const { stdout } = execute(chatbotCode, 'chatbot.py');
    expect(stdout).toContain('[chatbot]');
    expect(stdout).toContain('3번째 턴');
    const finished = baseState(lesson.files['main.py'], stdout, { 'chatbot.py': chatbotCode });
    expect(passes('chat-chatbot', finished)).toBe(true);
  });

  it('does not award the later missions for the starting program', () => {
    const stdout = execute(lesson.files['main.py']).stdout;
    const starter = baseState(lesson.files['main.py'], stdout);
    for (const id of ['chat-request', 'chat-first-call', 'chat-response', 'chat-roles', 'chat-parameters', 'chat-stream', 'chat-chatbot']) {
      expect(passes(id, starter), id).toBe(false);
    }
  });
});
