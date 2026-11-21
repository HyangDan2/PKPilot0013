import { describe, expect, it } from 'vitest';
import { Shell } from '../src/tracks/linux/shell';

const run = (shell: Shell, command: string) => {
  const result = shell.exec(command);
  return {
    out: result.lines.map((line) => line.text).join('\n'),
    exit: result.exit,
    result,
  };
};

const findPath = (tree: ReturnType<Shell['snapshot']>['tree'], path: string): { type: string; content?: string } | null => {
  const segments = path.split('/').filter(Boolean);
  let level = tree;
  let found: { type: string; content?: string } | null = null;
  for (const segment of segments) {
    const entry = level.find((item) => item.name === segment);
    if (!entry) return null;
    found = entry;
    level = entry.children ?? [];
  }
  return found;
};

describe('linux shell', () => {
  it('starts in /home/learner/work and prints the prompt path', () => {
    const shell = new Shell();
    expect(shell.cwdPath()).toBe('/home/learner/work');
    expect(shell.prompt).toBe('learner@visna:~/work$');
    expect(run(shell, 'pwd').out).toBe('/home/learner/work');
  });

  it('lists names, colours directories and supports -la', () => {
    const shell = new Shell();
    const plain = shell.exec('ls');
    expect(plain.lines.map((line) => line.text).join(' ')).toContain('notes.md');
    const spans = plain.lines.flatMap((line) => line.spans ?? []);
    expect(spans.some((span) => span.tone === 'dir' && span.text.trim() === 'projects')).toBe(true);

    const long = run(shell, 'ls -la').out;
    expect(long).toContain('drwxr-xr-x');
    expect(long).toContain('.');
  });

  it('moves around, remembering the previous directory', () => {
    const shell = new Shell();
    run(shell, 'cd projects');
    expect(shell.cwdPath()).toBe('/home/learner/work/projects');
    run(shell, 'cd -');
    expect(shell.cwdPath()).toBe('/home/learner/work');
    const missing = run(shell, 'cd nowhere');
    expect(missing.exit).toBe(1);
    expect(missing.out).toContain('No such file or directory');
    run(shell, 'cd ~');
    expect(shell.cwdPath()).toBe('/home/learner');
  });

  it('creates directories and files and writes with a redirect', () => {
    const shell = new Shell();
    run(shell, 'mkdir practice');
    run(shell, 'touch practice/todo.txt');
    expect(findPath(shell.snapshot().tree, '/home/learner/work/practice/todo.txt')?.type).toBe('file');

    run(shell, 'echo "리눅스 연습" > practice/todo.txt');
    expect(findPath(shell.snapshot().tree, '/home/learner/work/practice/todo.txt')?.content).toContain('리눅스 연습');

    run(shell, 'echo "한 줄 더" >> practice/todo.txt');
    const content = findPath(shell.snapshot().tree, '/home/learner/work/practice/todo.txt')?.content ?? '';
    expect(content.split('\n').filter(Boolean)).toHaveLength(2);

    expect(run(shell, 'mkdir practice').exit).toBe(1);
    expect(run(shell, 'mkdir -p deep/a/b').exit).toBe(0);
  });

  it('pipes cat into grep and wc', () => {
    const shell = new Shell();
    const result = run(shell, 'cat ~/logs/access.log | grep 404 | wc -l');
    expect(result.exit).toBe(0);
    expect(result.out.trim()).toBe('3');

    const grep = run(shell, 'grep -n 404 ~/logs/access.log');
    expect(grep.out.split('\n')[0]).toMatch(/^\d+:.*404/);

    const miss = run(shell, 'grep 500 ~/logs/access.log');
    expect(miss.exit).toBe(1);
  });

  it('reads heads, tails and counts', () => {
    const shell = new Shell();
    const head = run(shell, 'head -n 2 ~/logs/access.log').out.trim().split('\n');
    expect(head).toHaveLength(2);
    const tail = run(shell, 'tail -n 1 ~/logs/access.log').out;
    expect(tail).toContain('legacy');
    const words = run(shell, 'cat ~/logs/access.log | wc -l').out.trim();
    expect(words).toBe('8');
  });

  it('finds files by name and prints a tree', () => {
    const shell = new Shell();
    const found = run(shell, 'find . -name "*.md"').out;
    expect(found).toContain('./notes.md');
    const tree = run(shell, 'tree .').out;
    expect(tree).toContain('projects');
    expect(tree).toContain('directories');
  });

  it('copies, moves and removes', () => {
    const shell = new Shell();
    run(shell, 'cp notes.md copy.md');
    expect(findPath(shell.snapshot().tree, '/home/learner/work/copy.md')?.type).toBe('file');
    run(shell, 'mv copy.md renamed.md');
    expect(findPath(shell.snapshot().tree, '/home/learner/work/copy.md')).toBeNull();
    expect(findPath(shell.snapshot().tree, '/home/learner/work/renamed.md')?.type).toBe('file');
    run(shell, 'rm renamed.md');
    expect(findPath(shell.snapshot().tree, '/home/learner/work/renamed.md')).toBeNull();
    expect(run(shell, 'rm projects').exit).toBe(1);
    expect(run(shell, 'rm -r projects').exit).toBe(0);
  });

  it('reports unknown commands and supports help and clear', () => {
    const shell = new Shell();
    const unknown = run(shell, 'sl');
    expect(unknown.exit).toBe(127);
    expect(unknown.out).toContain('command not found');
    expect(run(shell, 'help').out).toContain('pwd');
    expect(shell.exec('clear').clear).toBe(true);
  });

  it('completes commands and paths with Tab', () => {
    const shell = new Shell();
    expect(shell.complete('pw')).toBe('pwd ');
    expect(shell.complete('cat not')).toBe('cat notes.md');
    expect(shell.complete('zzz')).toBeNull();
  });
});
