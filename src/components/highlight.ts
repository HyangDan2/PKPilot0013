/**
 * A small, dependency-free tokeniser for the editor overlay: enough to colour
 * comments, strings, numbers, keywords and calls the way the eye expects,
 * without shipping a language server.
 */
export type Lang = 'js' | 'py' | 'sh' | 'sql' | 'css' | 'md';

export interface Token {
  text: string;
  cls?: 'kw' | 'st' | 'cm' | 'nu' | 'fn' | 'op';
}

const KEYWORDS: Record<Lang, string[]> = {
  js: [
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'class', 'new',
    'import', 'export', 'default', 'from', 'async', 'await', 'try', 'catch', 'throw', 'typeof',
    'instanceof', 'this', 'true', 'false', 'null', 'undefined', 'switch', 'case', 'break', 'continue',
  ],
  py: [
    'def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'import', 'from',
    'as', 'with', 'try', 'except', 'finally', 'raise', 'class', 'yield', 'lambda', 'pass', 'break',
    'continue', 'True', 'False', 'None', 'is', 'global', 'print', 'len', 'sum', 'range', 'str', 'int',
    'float', 'list', 'dict', 'set', 'round', 'sorted',
  ],
  sh: [
    'if', 'then', 'else', 'fi', 'for', 'in', 'do', 'done', 'while', 'case', 'esac', 'export', 'echo',
    'cd', 'ls', 'cat', 'grep', 'wc', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'find', 'pwd', 'tree', 'head',
    'tail', 'clear',
  ],
  sql: [
    'select', 'from', 'where', 'order', 'by', 'group', 'having', 'join', 'left', 'right', 'inner',
    'outer', 'on', 'as', 'limit', 'offset', 'insert', 'into', 'values', 'update', 'set', 'delete',
    'create', 'table', 'primary', 'key', 'foreign', 'references', 'and', 'or', 'not', 'null', 'desc',
    'asc', 'distinct', 'count', 'sum', 'avg', 'min', 'max', 'round', 'like', 'between',
  ],
  css: ['media', 'import', 'from', 'and', 'root', 'important'],
  md: [],
};

export const langForPath = (path: string): Lang => {
  if (path.endsWith('.py')) return 'py';
  if (path.endsWith('.sh')) return 'sh';
  if (path.endsWith('.sql')) return 'sql';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.md')) return 'md';
  return 'js';
};

const COMMENT: Record<Lang, RegExp> = {
  js: /(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/y,
  py: /#[^\n]*/y,
  sh: /#[^\n]*/y,
  sql: /--[^\n]*/y,
  css: /\/\*[\s\S]*?\*\//y,
  md: /(?!)/y,
};

const STRING = /(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`)/y;
const NUMBER = /\b\d+(?:\.\d+)?\b/y;
const CALL = /\b[A-Za-z_$][\w$]*(?=\s*\()/y;

const matchAt = (re: RegExp, code: string, index: number): string | null => {
  re.lastIndex = index;
  const match = re.exec(code);
  return match ? match[0] : null;
};

export function tokenize(code: string, lang: Lang): Token[] {
  const tokens: Token[] = [];
  const keywords = KEYWORDS[lang];
  const insensitive = lang === 'sql';
  const keywordRe = keywords.length
    ? new RegExp(`\\b(?:${keywords.join('|')})\\b`, insensitive ? 'iy' : 'y')
    : null;
  let plain = '';
  let index = 0;

  const flush = () => {
    if (plain) {
      tokens.push({ text: plain });
      plain = '';
    }
  };

  while (index < code.length) {
    const char = code[index];
    const comment = char === '#' || char === '/' || char === '-' ? matchAt(COMMENT[lang], code, index) : null;
    if (comment) {
      flush();
      tokens.push({ text: comment, cls: 'cm' });
      index += comment.length;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const string = matchAt(STRING, code, index);
      if (string) {
        flush();
        tokens.push({ text: string, cls: 'st' });
        index += string.length;
        continue;
      }
    }
    if (/\d/.test(char) && !/[\w$]/.test(code[index - 1] ?? '')) {
      const number = matchAt(NUMBER, code, index);
      if (number) {
        flush();
        tokens.push({ text: number, cls: 'nu' });
        index += number.length;
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(char) && !/[\w$]/.test(code[index - 1] ?? '')) {
      const keyword = keywordRe ? matchAt(keywordRe, code, index) : null;
      if (keyword) {
        flush();
        tokens.push({ text: keyword, cls: 'kw' });
        index += keyword.length;
        continue;
      }
      const call = matchAt(CALL, code, index);
      if (call) {
        flush();
        tokens.push({ text: call, cls: 'fn' });
        index += call.length;
        continue;
      }
    }
    plain += char;
    index += 1;
  }
  flush();
  return tokens;
}
