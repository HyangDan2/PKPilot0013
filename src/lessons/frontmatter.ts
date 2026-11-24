/**
 * The lesson loader: a small, strict reader for the YAML subset a lesson
 * frontmatter needs — nested maps, `- ` lists, inline `[a, b]` / `{ ko, en }`
 * collections and `|` block scalars (used for starting files and Markdown).
 *
 * It is deliberately not a general YAML parser: unknown shapes fail loudly so a
 * broken lesson file is caught by the unit suite instead of rendering a half
 * empty IDE.
 */
import type {
  CheckSpec,
  CompletionDefaults,
  CompletionMode,
  Lesson,
  LessonMission,
  Localized,
  PanelId,
  RuntimeId,
} from './types';

export const PANEL_IDS: PanelId[] = ['output', 'completion', 'git-graph', 'working-tree'];
export const RUNTIME_IDS: RuntimeId[] = ['python', 'git'];

const DEFAULT_PANELS: Record<RuntimeId, PanelId[]> = {
  python: ['output'],
  git: ['git-graph', 'working-tree'],
};

export class LessonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LessonParseError';
  }
}

// ── frontmatter ──────────────────────────────────────────────────────────────

export interface SplitDoc {
  yaml: string;
  body: string;
}

export function splitFrontmatter(source: string): SplitDoc {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.startsWith('---\n')) throw new LessonParseError('frontmatter must start with --- on the first line');
  const end = text.indexOf('\n---', 3);
  if (end === -1) throw new LessonParseError('frontmatter is not closed with ---');
  const yaml = text.slice(4, end + 1);
  const after = text.slice(end + 4);
  return { yaml, body: after.replace(/^\n+/, '').trimEnd() + '\n' };
}

// ── YAML subset ──────────────────────────────────────────────────────────────

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isSkippable = (line: string): boolean => line.trim() === '' || line.trim().startsWith('#');

const nextContentLine = (lines: string[], from: number): number => {
  for (let i = from; i < lines.length; i += 1) if (!isSkippable(lines[i])) return i;
  return -1;
};

export function splitTopLevel(text: string, separator = ','): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[' || char === '{') depth += 1;
    if (char === ']' || char === '}') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() || parts.length > 0) parts.push(current.trim());
  return parts.filter((part) => part !== '');
}

export function parseScalar(raw: string): unknown {
  const text = raw.trim();
  if (text === '') return '';
  if (text.startsWith('[') && text.endsWith(']')) {
    return splitTopLevel(text.slice(1, -1)).map((item) => parseScalar(item));
  }
  if (text.startsWith('{') && text.endsWith('}')) {
    const map: Record<string, unknown> = {};
    for (const pair of splitTopLevel(text.slice(1, -1))) {
      const colon = pair.indexOf(':');
      if (colon === -1) throw new LessonParseError(`inline map entry without a colon: ${pair}`);
      map[pair.slice(0, colon).trim()] = parseScalar(pair.slice(colon + 1));
    }
    return map;
  }
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    return text
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\');
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d+\.\d+$/.test(text)) return Number(text);
  return text;
}

const KEY_LINE = /^([A-Za-z0-9_.-]+):(?:[ \t]+(.*))?$/;

function readBlockScalar(
  lines: string[],
  from: number,
  parentIndent: number,
): { text: string; next: number } {
  const collected: string[] = [];
  let minIndent = Number.POSITIVE_INFINITY;
  let i = from;
  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === '') {
      collected.push('');
      i += 1;
      continue;
    }
    const indent = indentOf(raw);
    if (indent <= parentIndent) break;
    minIndent = Math.min(minIndent, indent);
    collected.push(raw);
    i += 1;
  }
  while (collected.length > 0 && collected[collected.length - 1].trim() === '') collected.pop();
  const slice = Number.isFinite(minIndent) ? minIndent : parentIndent + 2;
  return { text: collected.map((line) => (line.trim() === '' ? '' : line.slice(slice))).join('\n'), next: i };
}

function parseBlock(lines: string[], from: number, indent: number): { value: unknown; next: number } {
  const start = nextContentLine(lines, from);
  if (start === -1) return { value: null, next: lines.length };
  const line = lines[start];
  const actual = indentOf(line);
  if (actual < indent) return { value: null, next: start };
  const trimmed = line.trim();
  if (trimmed.startsWith('- ') || trimmed === '-') return parseList(lines, start, actual);
  if (KEY_LINE.test(trimmed)) return parseMap(lines, start, actual);
  return { value: parseScalar(trimmed), next: start + 1 };
}

function parseMap(lines: string[], from: number, indent: number): { value: Record<string, unknown>; next: number } {
  const value: Record<string, unknown> = {};
  let i = from;
  while (i < lines.length) {
    if (isSkippable(lines[i])) {
      i += 1;
      continue;
    }
    const raw = lines[i];
    const actual = indentOf(raw);
    if (actual < indent) break;
    if (actual > indent) throw new LessonParseError(`unexpected indentation: "${raw.trim()}"`);
    const match = KEY_LINE.exec(raw.trim());
    if (!match) throw new LessonParseError(`expected "key: value" but found "${raw.trim()}"`);
    const key = match[1];
    const rest = (match[2] ?? '').trim();
    i += 1;
    if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-') {
      const block = readBlockScalar(lines, i, indent);
      value[key] = block.text;
      i = block.next;
      continue;
    }
    if (rest === '') {
      const probe = nextContentLine(lines, i);
      if (probe !== -1 && indentOf(lines[probe]) > indent) {
        const nested = parseBlock(lines, i, indentOf(lines[probe]));
        value[key] = nested.value;
        i = nested.next;
      } else {
        value[key] = null;
      }
      continue;
    }
    value[key] = parseScalar(rest);
  }
  return { value, next: i };
}

function parseList(lines: string[], from: number, indent: number): { value: unknown[]; next: number } {
  const value: unknown[] = [];
  let i = from;
  while (i < lines.length) {
    if (isSkippable(lines[i])) {
      i += 1;
      continue;
    }
    const raw = lines[i];
    const actual = indentOf(raw);
    if (actual < indent) break;
    const trimmed = raw.trim();
    if (!trimmed.startsWith('-')) break;
    if (actual > indent) throw new LessonParseError(`unexpected indentation in list: "${trimmed}"`);
    const after = trimmed === '-' ? '' : trimmed.slice(1).trimStart();
    let end = i + 1;
    while (end < lines.length) {
      const candidate = lines[end];
      if (candidate.trim() === '') {
        end += 1;
        continue;
      }
      if (indentOf(candidate) <= indent) break;
      end += 1;
    }
    // "- key: value" keeps the item content two columns to the right of the dash,
    // so the following sibling keys line up with it.
    const first = `${' '.repeat(indent)}  ${after}`;
    const collection = [first, ...lines.slice(i + 1, end)];
    const item = parseBlock(collection, 0, indentOf(first));
    value.push(item.value);
    i = end;
  }
  return { value, next: i };
}

export function parseYaml(source: string): Record<string, unknown> {
  const lines = source.split('\n');
  const start = nextContentLine(lines, 0);
  if (start === -1) return {};
  const parsed = parseBlock(lines, start, indentOf(lines[start]));
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    throw new LessonParseError('frontmatter must be a mapping of keys to values');
  }
  return parsed.value as Record<string, unknown>;
}

// ── lesson mapping ───────────────────────────────────────────────────────────

const asString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LessonParseError(`"${field}" must be a non-empty string`);
  }
  return value.trim();
};

/** Like `asString`, but an omitted or empty value is a valid default. */
const asOptionalString = (value: unknown, field: string): string => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new LessonParseError(`"${field}" must be a string`);
  return value;
};

const asLocalized = (value: unknown, field: string): Localized => {
  if (typeof value === 'string') return { ko: value, en: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LessonParseError(`"${field}" must be { ko, en } or a string`);
  }
  const record = value as Record<string, unknown>;
  const ko = asString(record.ko ?? record.en, `${field}.ko`);
  const en = asString(record.en ?? record.ko, `${field}.en`);
  return { ko, en };
};

const asStringList = (value: unknown, field: string): string[] => {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) throw new LessonParseError(`"${field}" must be a list`);
  return value.map((item, index) => asString(item, `${field}[${index}]`));
};

const asRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LessonParseError(`"${field}" must be a mapping`);
  }
  return value as Record<string, unknown>;
};

export function toCheck(value: unknown, field = 'check'): CheckSpec {
  if (Array.isArray(value)) {
    if (value.length === 0) throw new LessonParseError(`"${field}" must not be empty`);
    return { type: 'all', checks: value.map((item, index) => toCheck(item, `${field}[${index}]`)) };
  }
  const record = asRecord(value, field);
  const type = asString(record.type, `${field}.type`);
  const optional = (key: string) => (record[key] === undefined || record[key] === null ? undefined : String(record[key]));
  switch (type) {
    case 'ran':
      return { type: 'ran' };
    case 'stdout-contains':
      return { type: 'stdout-contains', value: asString(record.value, `${field}.value`) };
    case 'stdout-matches':
      return { type: 'stdout-matches', value: regexSource(record.value, `${field}.value`) };
    case 'stdout-lines':
      return { type: 'stdout-lines', values: asStringList(record.values, `${field}.values`) };
    case 'file-contains':
      return { type: 'file-contains', path: optional('path'), value: asString(record.value, `${field}.value`) };
    case 'file-matches':
      return { type: 'file-matches', path: optional('path'), value: regexSource(record.value, `${field}.value`) };
    case 'git-init':
      return { type: 'git-init' };
    case 'git-commits':
      return { type: 'git-commits', min: Number(record.min ?? 1) };
    case 'git-branch':
      return { type: 'git-branch', name: asString(record.name, `${field}.name`) };
    case 'git-merge':
      return { type: 'git-merge' };
    case 'git-remote':
      return { type: 'git-remote', name: optional('name') };
    case 'git-push':
      return { type: 'git-push', remote: optional('remote'), branch: optional('branch') };
    case 'all':
      return toCheck(record.checks, `${field}.checks`);
    default:
      throw new LessonParseError(`unknown check type "${type}" in "${field}"`);
  }
}

const regexSource = (value: unknown, field: string): string => {
  const source = asString(value, field);
  try {
    // fail here, not at the first command the learner types
    new RegExp(source);
  } catch {
    throw new LessonParseError(`"${field}" is not a valid regular expression: ${source}`);
  }
  return source;
};

function toMission(value: unknown, index: number): LessonMission {
  const record = asRecord(value, `missions[${index}]`);
  return {
    id: asString(record.id, `missions[${index}].id`),
    title: asLocalized(record.title, `missions[${index}].title`),
    goal: asLocalized(record.goal, `missions[${index}].goal`),
    hint: asLocalized(record.hint, `missions[${index}].hint`),
    check: toCheck(record.check, `missions[${index}].check`),
  };
}

function toCompletion(value: unknown): CompletionDefaults {
  const record = asRecord(value, 'completion');
  const mode = (record.mode ?? 'mock') as CompletionMode;
  if (mode !== 'mock' && mode !== 'live') {
    throw new LessonParseError('"completion.mode" must be "mock" or "live"');
  }
  return {
    mode,
    baseUrl: asOptionalString(record.baseUrl, 'completion.baseUrl'),
    model: asOptionalString(record.model, 'completion.model'),
    system: asOptionalString(record.system, 'completion.system'),
    user: asOptionalString(record.user, 'completion.user'),
  };
}

function toRunTimeoutMs(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new LessonParseError('"runTimeout" must be a positive number of seconds');
  }
  return Math.round(seconds * 1000);
}

export function lessonFromData(data: Record<string, unknown>, body: string, file = 'lesson.md'): Lesson {
  const runtime = asString(data.runtime, 'runtime') as RuntimeId;
  if (!RUNTIME_IDS.includes(runtime)) {
    throw new LessonParseError(`${file}: runtime must be one of ${RUNTIME_IDS.join(', ')} (got "${runtime}")`);
  }
  const declared = asStringList(data.panels, 'panels') as PanelId[];
  const unknownPanel = declared.find((panel) => !PANEL_IDS.includes(panel));
  if (unknownPanel) {
    throw new LessonParseError(`${file}: unknown panel "${unknownPanel}" — allowed: ${PANEL_IDS.join(', ')}`);
  }
  const panels = declared.length > 0 ? [...new Set(declared)] : [...DEFAULT_PANELS[runtime]];

  const files: Record<string, string> = {};
  if (data.files !== undefined && data.files !== null) {
    for (const [path, content] of Object.entries(asRecord(data.files, 'files'))) {
      files[path] = typeof content === 'string' ? content.replace(/\n$/, '') : String(content);
    }
  }
  if (Object.keys(files).length === 0) throw new LessonParseError(`${file}: "files" must declare at least one file`);

  const entry = data.entry === undefined || data.entry === null ? Object.keys(files)[0] : asString(data.entry, 'entry');
  if (!(entry in files)) throw new LessonParseError(`${file}: entry "${entry}" is not one of the declared files`);

  const missions = Array.isArray(data.missions) ? data.missions.map((mission, index) => toMission(mission, index)) : [];
  const ids = new Set<string>();
  for (const mission of missions) {
    if (ids.has(mission.id)) throw new LessonParseError(`${file}: duplicate mission id "${mission.id}"`);
    ids.add(mission.id);
  }

  const completion = data.completion === undefined || data.completion === null ? undefined : toCompletion(data.completion);
  if (panels.includes('completion') && !completion) {
    throw new LessonParseError(`${file}: the "completion" panel needs a "completion" section`);
  }

  return {
    id: asString(data.id, 'id'),
    title: asLocalized(data.title, 'title'),
    subtitle: asLocalized(data.subtitle, 'subtitle'),
    level: asLocalized(data.level ?? { ko: '기초', en: 'Beginner' }, 'level'),
    runtime,
    entry,
    panels,
    order: data.order === undefined ? 99 : Number(data.order),
    files,
    missions,
    body,
    runTimeoutMs: toRunTimeoutMs(data.runTimeout),
    completion,
  };
}

export function parseLessonDoc(source: string, file = 'lesson.md'): Lesson {
  const { yaml, body } = splitFrontmatter(source);
  if (body.trim() === '') throw new LessonParseError(`${file}: the markdown body is empty`);
  return lessonFromData(parseYaml(yaml), body, file);
}
