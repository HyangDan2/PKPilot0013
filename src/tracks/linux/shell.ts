/**
 * A small POSIX-ish shell over an in-memory file system: the commands a first
 * Linux session needs, with pipes and redirects, so learners type the real
 * thing instead of clicking a simulated menu.
 */
import { type CommandResult, type OutLine, mix, out, result } from '../types';

export type DirNode = { type: 'dir'; children: Record<string, FsNode> };
export type FileNode = { type: 'file'; content: string };
export type FsNode = DirNode | FileNode;

export interface TreeEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  content?: string;
  children?: TreeEntry[];
}

interface RunOut {
  stdout: string;
  stderr: string;
  lines?: OutLine[];
  code: number;
}

interface Stage {
  argv: string[];
  redirect?: { mode: '>' | '>>'; path: string };
}

const dir = (children: Record<string, FsNode> = {}): DirNode => ({ type: 'dir', children });
const file = (content: string): FileNode => ({ type: 'file', content });

const clone = <T>(node: T): T => JSON.parse(JSON.stringify(node)) as T;

export const ACCESS_LOG = [
  '10.0.0.12 - - [21/Nov/2026:09:01:11 +0900] "GET /index.html HTTP/1.1" 200 5120',
  '10.0.0.12 - - [21/Nov/2026:09:01:12 +0900] "GET /app.css HTTP/1.1" 200 1820',
  '10.0.0.41 - - [21/Nov/2026:09:02:40 +0900] "GET /missing.html HTTP/1.1" 404 512',
  '10.0.0.55 - - [21/Nov/2026:09:03:05 +0900] "POST /api/login HTTP/1.1" 200 640',
  '10.0.0.55 - - [21/Nov/2026:09:03:06 +0900] "GET /dashboard HTTP/1.1" 200 9020',
  '10.0.0.77 - - [21/Nov/2026:09:04:19 +0900] "GET /favicon.ico HTTP/1.1" 404 204',
  '10.0.0.88 - - [21/Nov/2026:09:05:31 +0900] "GET /api/status HTTP/1.1" 200 128',
  '10.0.0.91 - - [21/Nov/2026:09:06:02 +0900] "GET /legacy/page HTTP/1.1" 404 512',
].join('\n');

export const seedFs = (): DirNode => ({
  type: 'dir',
  children: {
    home: dir({
      learner: dir({
        work: dir({
          'notes.md': file(
            [
              '# 리눅스 실습 노트',
              '',
              '- pwd: 지금 있는 폴더를 알려 줍니다.',
              '- ls -la: 숨김 파일까지 보여 줍니다.',
              '- cd <폴더>: 폴더를 옮겨 다닙니다.',
            ].join('\n'),
          ),
          projects: dir({ 'hello.txt': file('Hello, Vísna Sól!\n') }),
        }),
        logs: dir({ 'access.log': file(ACCESS_LOG) }),
        'README.md': file(
          ['# /home/learner', '', '학습용 홈 디렉터리입니다. work/ 와 logs/ 를 살펴보세요.', ''].join('\n'),
        ),
      }),
    }),
    etc: dir({ hostname: file('visna-sol\n'), 'os-release': file('NAME="Vísna Sól Sandbox"\nVERSION="1.0"\n') }),
    usr: dir({ bin: dir({ 'run.sh': file('#!/bin/sh\necho "Vísna Sól"\n') }) }),
    tmp: dir({}),
  },
});

const COMMANDS = [
  'pwd', 'ls', 'cd', 'mkdir', 'touch', 'cat', 'echo', 'cp', 'mv', 'rm', 'grep', 'wc',
  'head', 'tail', 'find', 'tree', 'clear', 'help',
];

const HELP: { cmd: string; ko: string }[] = [
  { cmd: 'pwd', ko: '현재 디렉터리 경로를 보여 줍니다' },
  { cmd: 'ls [-la] [경로]', ko: '목록을 보여 줍니다 (-l 자세히, -a 숨김 포함)' },
  { cmd: 'cd [경로]', ko: '디렉터리를 이동합니다 (cd - 는 이전 위치)' },
  { cmd: 'mkdir [-p] <이름>', ko: '디렉터리를 만듭니다' },
  { cmd: 'touch <이름>', ko: '빈 파일을 만듭니다' },
  { cmd: 'cat <파일>', ko: '파일 내용을 출력합니다' },
  { cmd: 'echo <문장> [> 파일]', ko: '문장을 출력하거나 파일에 씁니다' },
  { cmd: 'cp [-r] <원본> <대상>', ko: '파일이나 디렉터리를 복사합니다' },
  { cmd: 'mv <원본> <대상>', ko: '옮기거나 이름을 바꿉니다' },
  { cmd: 'rm [-rf] <경로>', ko: '파일이나 디렉터리를 지웁니다' },
  { cmd: 'grep [-in] <패턴> [파일]', ko: '패턴이 있는 줄을 찾습니다' },
  { cmd: 'wc [-lwc] [파일]', ko: '줄·단어·바이트 수를 셉니다' },
  { cmd: 'head [-n N] [-파일]', ko: '앞부분을 출력합니다' },
  { cmd: 'tail [-n N] [파일]', ko: '뒷부분을 출력합니다' },
  { cmd: 'find [경로] -name <패턴>', ko: '이름으로 파일을 찾습니다' },
  { cmd: 'tree [경로]', ko: '디렉터리 구조를 그립니다' },
  { cmd: 'clear', ko: '터미널을 지웁니다' },
];

/** Split a line into pipeline stages, honouring quotes. */
function parsePipeline(input: string): { stages: Stage[]; error?: string } {
  const stages: Stage[] = [];
  let tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  const pushToken = () => {
    if (has || current) tokens.push(current);
    current = '';
    has = false;
  };
  const pushStage = () => {
    pushToken();
    if (!tokens.length) return;
    const stage: Stage = { argv: [] };
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token === '>' || token === '>>') {
        stage.redirect = { mode: token, path: tokens[i + 1] ?? '' };
        i += 1;
      } else {
        stage.argv.push(token);
      }
    }
    stages.push(stage);
    tokens = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      has = true;
      continue;
    }
    if (char === '|') {
      pushStage();
      continue;
    }
    if (/\s/.test(char)) {
      pushToken();
      continue;
    }
    if (char === '>') {
      pushToken();
      if (input[i + 1] === '>') {
        tokens.push('>>');
        i += 1;
      } else {
        tokens.push('>');
      }
      continue;
    }
    current += char;
    has = true;
  }
  pushStage();
  return { stages };
}

export class Shell {
  root: DirNode = seedFs();
  cwd: string[] = ['home', 'learner', 'work'];
  private previous: string[] = ['home', 'learner'];
  history: string[] = [];

  get prompt(): string {
    return `learner@visna:${this.cwdLabel()}$`;
  }

  cwdPath(): string {
    return `/${this.cwd.join('/')}`;
  }

  cwdLabel(): string {
    const path = this.cwdPath();
    if (path === '/home/learner') return '~';
    if (path.startsWith('/home/learner/')) return `~${path.slice('/home/learner'.length)}`;
    return path;
  }

  reset(): void {
    this.root = seedFs();
    this.cwd = ['home', 'learner', 'work'];
    this.history = [];
  }

  // ── path helpers ───────────────────────────────────────────────────────────
  private normalize(path: string): string[] {
    const base = path.startsWith('/') ? [] : [...this.cwd];
    const parts = path.split('/');
    const stack = [...base];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop();
      else if (part === '~') {
        stack.length = 0;
        stack.push('home', 'learner');
      } else stack.push(part);
    }
    return stack;
  }

  private lookup(segments: string[]): FsNode | null {
    let node: FsNode = this.root;
    for (const segment of segments) {
      if (node.type !== 'dir') return null;
      const next: FsNode | undefined = node.children[segment];
      if (!next) return null;
      node = next;
    }
    return node;
  }

  private parentOf(segments: string[]): DirNode | null {
    const parent = this.lookup(segments.slice(0, -1));
    return parent && parent.type === 'dir' ? parent : null;
  }

  private display(segments: string[]): string {
    return `/${segments.join('/')}`;
  }

  // ── execution ──────────────────────────────────────────────────────────────
  exec(input: string): CommandResult {
    const trimmed = input.trim();
    if (!trimmed) return result([]);
    this.history.push(trimmed);
    const { stages } = parsePipeline(trimmed);
    if (!stages.length) return result([]);
    if (stages.length === 1 && stages[0].argv[0] === 'clear') {
      return { lines: [], exit: 0, clear: true };
    }

    const lines: OutLine[] = [];
    let stdin = '';
    let exit = 0;
    for (let index = 0; index < stages.length; index += 1) {
      const stage = stages[index];
      const argv = stage.argv.map((arg) => arg.replace(/\$PWD/g, this.cwdPath()).replace(/\$HOME/g, '/home/learner'));
      const run = this.runCommand(argv, stdin);
      stdin = run.stdout;
      exit = run.code;
      const isLast = index === stages.length - 1;
      if (stage.redirect) {
        const target = this.normalize(stage.redirect.path);
        const parent = this.parentOf(target);
        if (!parent) {
          lines.push(out(`bash: ${stage.redirect.path}: No such file or directory`, 'err'));
          exit = 1;
        } else {
          const name = target[target.length - 1];
          const existing = parent.children[name];
          const body = run.stdout.endsWith('\n') || run.stdout === '' ? run.stdout : `${run.stdout}\n`;
          parent.children[name] = file(stage.redirect.mode === '>>' && existing?.type === 'file' ? existing.content + body : body);
        }
      } else if (isLast && run.lines) {
        lines.push(...run.lines);
      } else if (isLast && run.stdout) {
        lines.push(...run.stdout.replace(/\n$/, '').split('\n').map((line) => out(line)));
      }
      if (run.stderr) lines.push(...run.stderr.replace(/\n$/, '').split('\n').map((line) => out(line, 'err')));
      exit = run.code;
      if (!isLast && run.code !== 0) break;
    }
    return { lines, exit };
  }

  private runCommand(argv: string[], stdin: string): RunOut {
    const [cmd, ...args] = argv;
    if (!cmd) return { stdout: '', stderr: '', code: 0 };
    switch (cmd) {
      case 'help':
        return {
          stdout: '',
          stderr: '',
          code: 0,
          lines: [
            out('Vísna Sól Linux 샌드박스 · 사용할 수 있는 명령', 'accent'),
            ...HELP.map((item) => mix(`  ${item.cmd.padEnd(26)}`, { text: item.ko, tone: 'dim' })),
            out('', 'plain'),
            out('  파이프(|)와 리다이렉트(>, >>)를 함께 쓸 수 있습니다.', 'dim'),
            out('  예) cat logs/access.log | grep 404 | wc -l', 'dim'),
          ],
        };
      case 'pwd':
        return { stdout: `${this.cwdPath()}\n`, stderr: '', code: 0, lines: [out(this.cwdPath(), 'dir')] };
      case 'ls':
        return this.ls(args);
      case 'cd':
        return this.cd(args);
      case 'mkdir':
        return this.mkdir(args);
      case 'touch':
        return this.touch(args);
      case 'cat':
        return this.cat(args, stdin);
      case 'echo':
        return { stdout: `${args.join(' ')}\n`, stderr: '', code: 0 };
      case 'cp':
        return this.cp(args);
      case 'mv':
        return this.mv(args);
      case 'rm':
        return this.rm(args);
      case 'grep':
        return this.grep(args, stdin);
      case 'wc':
        return this.wc(args, stdin);
      case 'head':
        return this.headTail(args, stdin, 'head');
      case 'tail':
        return this.headTail(args, stdin, 'tail');
      case 'find':
        return this.find(args);
      case 'tree':
        return this.tree(args);
      case 'clear':
        return { stdout: '', stderr: '', code: 0 };
      default:
        return { stdout: '', stderr: `bash: ${cmd}: command not found\n`, code: 127 };
    }
  }

  private ls(args: string[]): RunOut {
    const flags = args.filter((arg) => arg.startsWith('-')).join('');
    const targets = args.filter((arg) => !arg.startsWith('-'));
    const long = flags.includes('l');
    const all = flags.includes('a');
    const target = targets[0] ?? '.';
    const segments = this.normalize(target);
    const node = this.lookup(segments);
    if (!node) {
      return { stdout: '', stderr: `ls: cannot access '${target}': No such file or directory\n`, code: 2 };
    }
    if (node.type === 'file') {
      const name = segments[segments.length - 1];
      return {
        stdout: `${name}\n`,
        stderr: '',
        code: 0,
        lines: [mix({ text: name, tone: 'file' })],
      };
    }
    const names = Object.keys(node.children).sort((a, b) => a.localeCompare(b));
    const visible = all ? ['.', '..', ...names] : names;
    if (long) {
      const lines: OutLine[] = [];
      for (const name of visible) {
        if (name === '.' || name === '..') {
          lines.push(out(`drwxr-xr-x 2 learner learner 4096 Nov 21 09:00 ${name}`, 'dim'));
          continue;
        }
        const child = node.children[name];
        const size = child.type === 'file' ? child.content.length : 4096;
        const mode = child.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
        lines.push(
          mix(`${mode} 1 learner learner ${String(size).padStart(5)} Nov 21 09:00 `, {
            text: name,
            tone: child.type === 'dir' ? 'dir' : 'file',
          }),
        );
      }
      return { stdout: lines.map((line) => line.text).join('\n') + '\n', stderr: '', code: 0, lines };
    }
    const cells = visible.map((name) => ({ name, dir: name !== '.' && name !== '..' && node.children[name]?.type === 'dir' }));
    const rows: OutLine[] = [];
    for (let i = 0; i < cells.length; i += 3) {
      const chunk = cells.slice(i, i + 3);
      const spans = chunk.flatMap((cell, index) => [
        { text: cell.name.padEnd(26), tone: (cell.dir ? 'dir' : 'file') as 'dir' | 'file' },
        ...(index < chunk.length - 1 ? [{ text: '' }] : []),
      ]);
      rows.push({ text: chunk.map((cell) => cell.name.padEnd(26)).join('').trimEnd(), spans });
    }
    return {
      stdout: cells.map((cell) => cell.name).join('\n') + '\n',
      stderr: '',
      code: 0,
      lines: rows,
    };
  }

  private cd(args: string[]): RunOut {
    const target = args[0];
    if (!target || target === '~') {
      this.cwd = ['home', 'learner'];
      return { stdout: '', stderr: '', code: 0 };
    }
    if (target === '-') {
      const swap = this.cwd;
      this.cwd = this.previous;
      this.previous = swap;
      return { stdout: `${this.cwdPath()}\n`, stderr: '', code: 0 };
    }
    const segments = this.normalize(target);
    const node = this.lookup(segments);
    if (!node) return { stdout: '', stderr: `cd: ${target}: No such file or directory\n`, code: 1 };
    if (node.type !== 'dir') return { stdout: '', stderr: `cd: ${target}: Not a directory\n`, code: 1 };
    this.previous = this.cwd;
    this.cwd = segments;
    return { stdout: '', stderr: '', code: 0 };
  }

  private mkdir(args: string[]): RunOut {
    const parents = args.includes('-p');
    const targets = args.filter((arg) => !arg.startsWith('-'));
    if (!targets.length) return { stdout: '', stderr: 'mkdir: missing operand\n', code: 1 };
    for (const target of targets) {
      const segments = this.normalize(target);
      if (segments.length === 0) return { stdout: '', stderr: `mkdir: cannot create directory '${target}': File exists\n`, code: 1 };
      if (parents) {
        let path: string[] = [];
        let node: FsNode = this.root;
        for (const segment of segments) {
          path = [...path, segment];
          if (node.type !== 'dir') break;
          if (!node.children[segment]) node.children[segment] = dir();
          node = node.children[segment];
        }
        continue;
      }
      const parent = this.parentOf(segments);
      const name = segments[segments.length - 1];
      if (!parent) return { stdout: '', stderr: `mkdir: cannot create directory '${target}': No such file or directory\n`, code: 1 };
      if (parent.children[name]) return { stdout: '', stderr: `mkdir: cannot create directory '${target}': File exists\n`, code: 1 };
      parent.children[name] = dir();
    }
    return { stdout: '', stderr: '', code: 0 };
  }

  private touch(args: string[]): RunOut {
    if (!args.length) return { stdout: '', stderr: 'touch: missing file operand\n', code: 1 };
    for (const target of args) {
      const segments = this.normalize(target);
      const parent = this.parentOf(segments);
      if (!parent) return { stdout: '', stderr: `touch: cannot touch '${target}': No such file or directory\n`, code: 1 };
      const name = segments[segments.length - 1];
      if (!parent.children[name]) parent.children[name] = file('');
    }
    return { stdout: '', stderr: '', code: 0 };
  }

  private readFiles(args: string[], stdin: string): { text: string; error?: string } {
    const files = args.filter((arg) => !arg.startsWith('-'));
    if (files.length === 0) return { text: stdin };
    const parts: string[] = [];
    for (const target of files) {
      const node = this.lookup(this.normalize(target));
      if (!node || node.type !== 'file') return { text: '', error: `${target}: No such file or directory` };
      parts.push(node.content);
    }
    return { text: parts.join('') };
  }

  private cat(args: string[], stdin: string): RunOut {
    const { text, error } = this.readFiles(args, stdin);
    if (error) return { stdout: '', stderr: `cat: ${error}\n`, code: 1 };
    return { stdout: text, stderr: '', code: 0 };
  }

  private cp(args: string[]): RunOut {
    const recursive = args.includes('-r') || args.includes('-R') || args.includes('-rf');
    const paths = args.filter((arg) => !arg.startsWith('-'));
    if (paths.length < 2) return { stdout: '', stderr: 'cp: missing destination file operand\n', code: 1 };
    const [source, dest] = paths;
    const sourceNode = this.lookup(this.normalize(source));
    if (!sourceNode) return { stdout: '', stderr: `cp: cannot stat '${source}': No such file or directory\n`, code: 1 };
    if (sourceNode.type === 'dir' && !recursive) {
      return { stdout: '', stderr: `cp: -r not specified; omitting directory '${source}'\n`, code: 1 };
    }
    let destSegments = this.normalize(dest);
    const destNode = this.lookup(destSegments);
    if (destNode && destNode.type === 'dir') destSegments = [...destSegments, this.normalize(source).slice(-1)[0]];
    const parent = this.parentOf(destSegments);
    if (!parent) return { stdout: '', stderr: `cp: cannot create '${dest}': No such file or directory\n`, code: 1 };
    parent.children[destSegments[destSegments.length - 1]] = clone(sourceNode);
    return { stdout: '', stderr: '', code: 0 };
  }

  private mv(args: string[]): RunOut {
    const paths = args.filter((arg) => !arg.startsWith('-'));
    if (paths.length < 2) return { stdout: '', stderr: 'mv: missing destination file operand\n', code: 1 };
    const [source, dest] = paths;
    const sourceSegments = this.normalize(source);
    const sourceNode = this.lookup(sourceSegments);
    if (!sourceNode) return { stdout: '', stderr: `mv: cannot stat '${source}': No such file or directory\n`, code: 1 };
    let destSegments = this.normalize(dest);
    const destNode = this.lookup(destSegments);
    if (destNode && destNode.type === 'dir') destSegments = [...destSegments, sourceSegments[sourceSegments.length - 1]];
    const parent = this.parentOf(destSegments);
    if (!parent) return { stdout: '', stderr: `mv: cannot move '${source}': No such file or directory\n`, code: 1 };
    parent.children[destSegments[destSegments.length - 1]] = sourceNode;
    const sourceParent = this.parentOf(sourceSegments);
    if (sourceParent) delete sourceParent.children[sourceSegments[sourceSegments.length - 1]];
    return { stdout: '', stderr: '', code: 0 };
  }

  private rm(args: string[]): RunOut {
    const recursive = args.some((arg) => /r/i.test(arg) && arg.startsWith('-'));
    const paths = args.filter((arg) => !arg.startsWith('-'));
    if (!paths.length) return { stdout: '', stderr: 'rm: missing operand\n', code: 1 };
    for (const target of paths) {
      const segments = this.normalize(target);
      const node = this.lookup(segments);
      if (!node) return { stdout: '', stderr: `rm: cannot remove '${target}': No such file or directory\n`, code: 1 };
      if (node.type === 'dir' && !recursive) {
        return { stdout: '', stderr: `rm: cannot remove '${target}': Is a directory\n`, code: 1 };
      }
      const parent = this.parentOf(segments);
      if (parent) delete parent.children[segments[segments.length - 1]];
    }
    return { stdout: '', stderr: '', code: 0 };
  }

  private grep(args: string[], stdin: string): RunOut {
    const flags = args.filter((arg) => arg.startsWith('-')).join('');
    const rest = args.filter((arg) => !arg.startsWith('-'));
    const [pattern, ...files] = rest;
    if (!pattern) return { stdout: '', stderr: 'usage: grep [-in] pattern [file...]\n', code: 2 };
    const { text, error } = this.readFiles(files, stdin);
    if (error) return { stdout: '', stderr: `grep: ${error}\n`, code: 2 };
    let matcher: (line: string) => boolean;
    try {
      const regex = new RegExp(pattern, flags.includes('i') ? 'i' : '');
      matcher = (line) => regex.test(line);
    } catch {
      matcher = (line) => line.includes(pattern);
    }
    const source = text.replace(/\n$/, '').split('\n');
    const hits = source
      .map((line, index) => ({ line, index }))
      .filter((entry) => (flags.includes('v') ? !matcher(entry.line) : matcher(entry.line)));
    if (!hits.length) return { stdout: '', stderr: '', code: 1 };
    return {
      stdout: hits.map((hit) => (flags.includes('n') ? `${hit.index + 1}:${hit.line}` : hit.line)).join('\n') + '\n',
      stderr: '',
      code: 0,
      lines: hits.map((hit) => mix(flags.includes('n') ? `${hit.index + 1}:` : '', { text: hit.line, tone: 'accent' })),
    };
  }

  private wc(args: string[], stdin: string): RunOut {
    const flags = args.filter((arg) => arg.startsWith('-')).join('');
    const files = args.filter((arg) => !arg.startsWith('-'));
    const { text, error } = this.readFiles(files, stdin);
    if (error) return { stdout: '', stderr: `wc: ${error}\n`, code: 1 };
    const lines = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const bytes = new TextEncoder().encode(text).length;
    const parts: number[] = [];
    if (flags.includes('l') || flags.length === 0) parts.push(lines);
    if (flags.includes('w') || flags.length === 0) parts.push(words);
    if (flags.includes('c') || flags.length === 0) parts.push(bytes);
    const suffix = files.length ? ` ${files.join(' ')}` : '';
    return { stdout: `${parts.join(' ')}${suffix}\n`, stderr: '', code: 0 };
  }

  private headTail(args: string[], stdin: string, mode: 'head' | 'tail'): RunOut {
    let count = 10;
    const files: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '-n') {
        count = Number(args[i + 1]) || 10;
        i += 1;
      } else if (/^-\d+$/.test(arg)) {
        count = Number(arg.slice(1));
      } else if (!arg.startsWith('-')) {
        files.push(arg);
      }
    }
    const { text, error } = this.readFiles(files, stdin);
    if (error) return { stdout: '', stderr: `${mode}: ${error}\n`, code: 1 };
    const lines = text.replace(/\n$/, '').split('\n');
    const slice = mode === 'head' ? lines.slice(0, count) : lines.slice(Math.max(0, lines.length - count));
    return { stdout: slice.join('\n') + (text.endsWith('\n') || text === '' ? '\n' : ''), stderr: '', code: 0 };
  }

  private find(args: string[]): RunOut {
    let start = '.';
    let pattern: string | null = null;
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '-name') {
        pattern = args[i + 1] ?? '*';
        i += 1;
      } else if (!args[i].startsWith('-')) {
        start = args[i];
      }
    }
    const segments = this.normalize(start);
    const rootNode = this.lookup(segments);
    if (!rootNode) return { stdout: '', stderr: `find: '${start}': No such file or directory\n`, code: 1 };
    const matches: string[] = [];
    const glob = pattern ? new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`) : null;
    const walk = (node: FsNode, path: string) => {
      const name = path.split('/').filter(Boolean).pop() ?? path;
      if (!glob || glob.test(name)) matches.push(path);
      if (node.type === 'dir') {
        for (const [childName, child] of Object.entries(node.children)) {
          walk(child, `${path === '/' ? '' : path}/${childName}`);
        }
      }
    };
    walk(rootNode, start === '.' ? '.' : this.display(segments));
    return {
      stdout: matches.join('\n') + '\n',
      stderr: '',
      code: 0,
      lines: matches.map((match) => mix({ text: match, tone: match.endsWith('/') ? 'dir' : 'path' })),
    };
  }

  private tree(args: string[]): RunOut {
    const target = args.find((arg) => !arg.startsWith('-')) ?? '.';
    const segments = this.normalize(target);
    const node = this.lookup(segments);
    if (!node || node.type !== 'dir') return { stdout: '', stderr: `tree: ${target}: Not a directory\n`, code: 1 };
    const lines: string[] = [target];
    let dirs = 0;
    let files = 0;
    const walk = (current: DirNode, prefix: string) => {
      const names = Object.keys(current.children).sort((a, b) => a.localeCompare(b));
      names.forEach((name, index) => {
        const child = current.children[name];
        const last = index === names.length - 1;
        lines.push(`${prefix}${last ? '└── ' : '├── '}${name}`);
        if (child.type === 'dir') {
          dirs += 1;
          walk(child, `${prefix}${last ? '    ' : '│   '}`);
        } else {
          files += 1;
        }
      });
    };
    walk(node, '');
    lines.push('', `${dirs} directories, ${files} files`);
    return { stdout: lines.join('\n') + '\n', stderr: '', code: 0 };
  }

  // ── introspection for the visualiser ───────────────────────────────────────
  snapshot(): { tree: TreeEntry[]; cwd: string; prompt: string } {
    const build = (node: DirNode, path: string): TreeEntry[] =>
      Object.entries(node.children)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, child]) => {
          const childPath = `${path}/${name}`;
          if (child.type === 'dir') {
            return { name, path: childPath, type: 'dir' as const, size: 0, children: build(child, childPath) };
          }
          return { name, path: childPath, type: 'file' as const, size: child.content.length, content: child.content };
        });
    return {
      tree: build(this.root, ''),
      cwd: this.cwdPath(),
      prompt: this.prompt,
    };
  }

  /** Tab completion over command names and the current directory. */
  complete(line: string): string | null {
    const parts = line.split(/\s+/);
    const typing = parts[parts.length - 1] ?? '';
    const first = parts.length === 1;
    const node = this.lookup(this.cwd);
    const entries = node && node.type === 'dir' ? Object.keys(node.children) : [];
    const pool = first ? COMMANDS : entries;
    const matches = pool.filter((item) => item.startsWith(typing));
    if (matches.length === 0) return null;
    if (first && matches.length > 1) return null;
    parts[parts.length - 1] = matches[0] + (first ? ' ' : '');
    return parts.join(' ');
  }
}
