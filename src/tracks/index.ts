import { gitSeed } from './git/repo';
import { sqlSeed } from './sql/db';
import type { TrackId } from './types';

export interface TrackConfig {
  id: TrackId;
  label: string;
  entry: string;
  prompt: string;
  /** Commands offered as one-tap chips on touch layouts. */
  chips: string[];
  files: () => Record<string, string>;
  /** Files the terminal itself can write to (SQL and Linux keep their own world). */
  terminalWritesFiles: boolean;
}

const pythonSeed = (): Record<string, string> => ({
  'hello.py': [
    '# Vísna Sól · Python',
    '# 실행: Ctrl+Enter 또는 오른쪽 위 실행 버튼',
    '',
    'name = "학습자"',
    'print(f"안녕하세요, {name}입니다.")',
    'print(2 + 3)',
  ].join('\n'),
  'numbers.py': [
    '# 리스트의 합계와 평균을 구해 봅시다.',
    'numbers = [12, 45, 7, 23, 88, 34, 61, 15]',
    '',
    '# TODO: 합계를 구해 print 로 출력해 보세요.',
    'print(0)',
  ].join('\n'),
  'loops.py': [
    '# for 문으로 1부터 10까지 출력해 보세요.',
    'for i in range(1, 4):',
    '    print(i)',
  ].join('\n'),
});

const linuxSeed = (): Record<string, string> => ({
  'script.sh': [
    '#!/bin/sh',
    '# Vísna Sól · 리눅스 실습 스크립트',
    '# 실행 버튼을 누르면 아래 명령이 위에서부터 차례대로 실행됩니다.',
    '',
    'pwd',
    'ls -la',
    'cat notes.md',
  ].join('\n'),
  'cheatsheet.md': [
    '# 명령 치트시트',
    '',
    '| 명령 | 하는 일 |',
    '| --- | --- |',
    '| pwd | 현재 경로 |',
    '| ls -la | 숨김 파일까지 목록 |',
    '| cd <폴더> | 이동 |',
    '| cat <파일> | 내용 출력 |',
    '| grep 404 <파일> | 패턴 찾기 |',
    '| wc -l | 줄 수 세기 |',
    '',
    '파이프와 리다이렉트를 조합해 보세요. 예) cat ~/logs/access.log | grep 404 | wc -l',
  ].join('\n'),
});

export const TRACKS: Record<TrackId, TrackConfig> = {
  git: {
    id: 'git',
    label: 'Git',
    entry: 'app.js',
    prompt: 'learner@visna:~/work$',
    chips: ['git status', 'git add .', 'git commit -m "메시지"', 'git log --oneline', 'git switch -c feature'],
    files: gitSeed,
    terminalWritesFiles: true,
  },
  python: {
    id: 'python',
    label: 'Python',
    entry: 'hello.py',
    prompt: 'learner@visna:~/python$',
    chips: ['python hello.py', 'python numbers.py', 'ls', 'clear'],
    files: pythonSeed,
    terminalWritesFiles: true,
  },
  linux: {
    id: 'linux',
    label: 'Linux',
    entry: 'script.sh',
    prompt: 'learner@visna:~/work$',
    chips: ['pwd', 'ls -la', 'cat notes.md', 'cat ~/logs/access.log | grep 404 | wc -l', 'find . -name "*.md"'],
    files: linuxSeed,
    terminalWritesFiles: false,
  },
  sql: {
    id: 'sql',
    label: 'SQL',
    entry: 'query.sql',
    prompt: 'sqlite>',
    chips: ['.tables', '.schema', 'SELECT * FROM employees;', 'SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 3;'],
    files: sqlSeed,
    terminalWritesFiles: false,
  },
};

export const TRACK_ORDER: TrackId[] = ['git', 'python', 'linux', 'sql'];
