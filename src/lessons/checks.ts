/**
 * Mission checks, evaluated against the live sandbox state. A lesson declares
 * what counts as done in its frontmatter; this is the one place those
 * declarations become booleans.
 */
import type {
  CheckSpec,
  LessonState,
  TracePreviewCheck,
  TraceRequestCheck,
  TraceResponseCheck,
  TraceStreamCheck,
  TraceTurnsCheck,
} from './types';
import type { TraceEvent, TraceKind } from '../tracks/python/trace';

const matchesAnyFile = (state: LessonState, test: (code: string) => boolean): boolean => {
  const entries = Object.entries(state.files);
  if (entries.length === 0) return false;
  return entries.some(([, code]) => test(code));
};

// ── trace checks ─────────────────────────────────────────────────────────────

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const eventsOf = (state: LessonState, kind: TraceKind): TraceEvent[] =>
  state.trace.filter((event) => event.kind === kind);

const lastOf = (state: LessonState, kind: TraceKind): unknown => {
  const events = eventsOf(state, kind);
  return events.length > 0 ? events[events.length - 1].data : undefined;
};

const requestBody = (event: TraceEvent): Record<string, unknown> | null => {
  const data = asRecord(event.data);
  return asRecord(data?.body);
};

const messageRoles = (body: Record<string, unknown> | null): string[] => {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => String(asRecord(message)?.role ?? ''));
};

const assistantContentAfter = (body: Record<string, unknown> | null): boolean => {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return false;
  let assistant = false;
  for (const raw of messages) {
    const message = asRecord(raw);
    if (!message) continue;
    if (message.role === 'assistant' && typeof message.content === 'string' && message.content.trim() !== '') {
      assistant = true;
    } else if (assistant && message.role === 'user') {
      return true;
    }
  }
  return false;
};

const authorizationOf = (event: TraceEvent): string | null => {
  const data = asRecord(event.data);
  const headers = asRecord(data?.headers);
  const value = headers?.Authorization;
  return typeof value === 'string' ? value : null;
};

function checkTraceRequest(check: TraceRequestCheck, state: LessonState): boolean {
  const requests = eventsOf(state, 'request');
  if (requests.length === 0) return false;
  if (check.minTurns !== undefined && requests.length < check.minTurns) return false;
  if (check.sent === false) return false; // a sent request is never a preview
  const event = requests[requests.length - 1];
  const body = requestBody(event);
  if (!body) return false;
  if (check.messages) {
    const roles = messageRoles(body);
    if (roles.length !== check.messages.length || roles.some((role, index) => role !== check.messages![index])) {
      return false;
    }
  }
  if (check.temperature !== undefined && body.temperature !== check.temperature) return false;
  if (check.maxTokens !== undefined && body.max_tokens !== check.maxTokens) return false;
  if (check.stream !== undefined && body.stream !== check.stream) return false;
  if (check.model !== undefined && body.model !== check.model) return false;
  if (check.assistantReuse && !assistantContentAfter(body)) return false;
  if (check.authorization) {
    const authorization = authorizationOf(event);
    if (check.authorization === 'absent' && authorization !== null) return false;
    if (check.authorization === 'masked') {
      if (!authorization || !/••••|\(masked\)|\(hidden\)/i.test(authorization)) return false;
    }
    if (check.authorization === 'any' && authorization === null) return false;
  }
  return true;
}

function checkTracePreview(check: TracePreviewCheck, state: LessonState): boolean {
  const previews = eventsOf(state, 'preview');
  if (previews.length === 0) return false;
  const body = requestBody(previews[previews.length - 1]);
  if (!body) return false;
  if (check.messages) {
    const roles = messageRoles(body);
    if (roles.length !== check.messages.length || roles.some((role, index) => role !== check.messages![index])) {
      return false;
    }
  }
  if (check.temperature !== undefined && body.temperature !== check.temperature) return false;
  if (check.maxTokens !== undefined && body.max_tokens !== check.maxTokens) return false;
  return true;
}

function checkTraceResponse(check: TraceResponseCheck, state: LessonState): boolean {
  const response = asRecord(lastOf(state, 'response'));
  if (!response) return false;
  const choices = response.choices;
  const choice = Array.isArray(choices) ? asRecord(choices[0]) : null;
  if (!choice) return false;
  if (check.finish !== undefined && choice.finish_reason !== check.finish) return false;
  if (check.assistant) {
    const message = asRecord(choice.message);
    if (typeof message?.content !== 'string' || message.content.trim() === '') return false;
  }
  if (check.usage) {
    const usage = asRecord(response.usage) ?? asRecord(lastOf(state, 'usage'));
    if (!usage || typeof usage.total_tokens !== 'number') return false;
  }
  return true;
}

function checkTraceStream(check: TraceStreamCheck, state: LessonState): boolean {
  const stream = asRecord(lastOf(state, 'stream'));
  if (!stream) return false;
  const chunks = typeof stream.chunks === 'number' ? stream.chunks : eventsOf(state, 'chunk').length;
  if (check.minChunks !== undefined && chunks < check.minChunks) return false;
  if (check.done !== undefined && stream.done !== check.done) return false;
  if (check.assistant && !checkTraceResponse({ type: 'trace-response', assistant: true }, state)) return false;
  return true;
}

function checkTraceTurns(check: TraceTurnsCheck, state: LessonState): boolean {
  const requests = eventsOf(state, 'request');
  if (requests.length < check.min) return false;
  if (!check.assistantReuse) return true;
  return requests.some((event) => assistantContentAfter(requestBody(event)));
}

export function evaluateCheck(check: CheckSpec, state: LessonState): boolean {
  switch (check.type) {
    case 'ran':
      return state.runs >= 1;
    case 'stdout-contains':
      return state.stdout.includes(check.value);
    case 'stdout-matches':
      return new RegExp(check.value).test(state.stdout);
    case 'stdout-lines': {
      const lines = state.stdout.split('\n').map((line) => line.trim());
      return check.values.every((value) => lines.includes(value));
    }
    case 'file-contains': {
      const wanted = check.value.trim();
      if (!wanted) return false;
      if (check.path) return (state.files[check.path] ?? '').includes(wanted);
      return matchesAnyFile(state, (code) => code.includes(wanted));
    }
    case 'file-matches': {
      const pattern = new RegExp(check.value);
      if (check.path) return pattern.test(state.files[check.path] ?? '');
      return matchesAnyFile(state, (code) => pattern.test(code));
    }
    case 'git-init':
      return state.gitInitialized;
    case 'git-commits':
      return state.gitTotalCommits >= check.min;
    case 'git-branch': {
      const branch = state.gitBranches.find((item) => item.name === check.name);
      if (!branch || !branch.sha) return false;
      // A branch counts once it has a commit of its own — a branch that still
      // points at main, or at an older commit main already contains, is not "a
      // branch of my own yet".
      const ahead = branch.ahead ?? (branch.sha === state.gitMainTip ? 0 : 1);
      return ahead >= 1;
    }
    case 'git-merge':
      // A merge is "두 브랜치를 합쳤다" whether git had to make a merge commit or
      // could simply fast-forward: both put the other branch's work on this one.
      return state.gitMergeCommits >= 1 || state.gitFastForwards >= 1;
    case 'git-remote': {
      const named = check.name ? state.gitRemotes.filter((remote) => remote.name === check.name) : state.gitRemotes;
      return named.some((remote) => remote.url.trim() !== '');
    }
    case 'git-push': {
      const remote = check.remote ?? 'origin';
      const branch = check.branch ?? 'main';
      const pushed = state.gitRemoteBranches.find((item) => item.ref === `${remote}/${branch}`);
      return !!pushed && !!pushed.sha && pushed.contained;
    }
    case 'trace-request':
      return checkTraceRequest(check, state);
    case 'trace-preview':
      return checkTracePreview(check, state);
    case 'trace-response':
      return checkTraceResponse(check, state);
    case 'trace-stream':
      return checkTraceStream(check, state);
    case 'trace-turns':
      return checkTraceTurns(check, state);
    case 'all':
      return check.checks.every((item) => evaluateCheck(item, state));
    default:
      return false;
  }
}
