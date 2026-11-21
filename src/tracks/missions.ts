/**
 * Guided missions for each track. A mission is one goal, one automatic pass
 * check over the live sandbox state, and one hint — no grading, no server.
 */
import type { Mission } from './types';
import type { GitSnapshot } from './git/repo';
import type { TreeEntry } from './linux/shell';
import type { SqlResult, SqlTable } from './sql/db';

// ── Git ──────────────────────────────────────────────────────────────────────
export type GitMissionState = GitSnapshot;

const mainTip = (state: GitMissionState) => state.branches.find((branch) => branch.name === 'main')?.sha ?? null;

export const gitMissions: Mission<GitMissionState>[] = [
  {
    id: 'git-init',
    title: { ko: '저장소 초기화', en: 'Initialise the repository' },
    goal: {
      ko: '터미널에 git init 을 입력해 이 폴더를 Git 저장소로 만들어 보세요.',
      en: 'Type git init in the terminal to turn this folder into a Git repository.',
    },
    hint: {
      ko: '터미널에 `git init` 을 입력하고 Enter를 누르세요. 오른쪽 커밋 그래프에 main 브랜치가 나타납니다.',
      en: 'Type `git init` and press Enter. The commit graph on the right will show the main branch.',
    },
    check: (state) => state.initialized,
  },
  {
    id: 'git-first-commit',
    title: { ko: '첫 커밋 만들기', en: 'Make the first commit' },
    goal: {
      ko: '파일을 하나 고친 뒤 git add . 와 git commit -m "메시지" 로 첫 커밋을 남겨 보세요.',
      en: 'Edit a file, then stage and record it with git add . and git commit -m "message".',
    },
    hint: {
      ko: '`app.js` 를 조금 고치고 `git add .` → `git commit -m "첫 커밋"` 순서로 입력하세요. 왼쪽 미션 목록의 스테이징 표시도 함께 바뀝니다.',
      en: 'Change `app.js`, then run `git add .` and `git commit -m "first commit"`. Watch the staging area in the sidebar change too.',
    },
    check: (state) => state.totalCommits >= 1,
  },
  {
    id: 'git-branch',
    title: { ko: '브랜치 만들고 이동하기', en: 'Create and switch a branch' },
    goal: {
      ko: 'git switch -c feature 로 새 브랜치를 만들고 그 위에서 커밋을 하나 남겨 보세요.',
      en: 'Create a branch with git switch -c feature and leave one commit on it.',
    },
    hint: {
      ko: '`git switch -c feature` 로 브랜치를 만들면 곧바로 이동합니다. 파일을 고치고 `git add .`, `git commit -m "기능 추가"` 를 실행하세요.',
      en: '`git switch -c feature` creates and moves in one step. Edit a file, then `git add .` and `git commit -m "add feature"`.',
    },
    check: (state) => {
      if (!state.branch || state.branch === 'main') return false;
      const current = state.branches.find((branch) => branch.name === state.branch);
      return !!current && current.sha !== mainTip(state);
    },
  },
  {
    id: 'git-merge',
    title: { ko: '두 브랜치 병합하기', en: 'Merge two branches' },
    goal: {
      ko: 'main에도 커밋을 하나 남긴 뒤 git merge 로 feature 브랜치를 병합해 보세요.',
      en: 'Add a commit on main as well, then bring feature in with git merge.',
    },
    hint: {
      ko: '`git switch main` → 파일 수정 → `git add .` → `git commit -m "main 작업"` → `git merge feature`. 양쪽에 커밋이 있으면 병합 커밋이 만들어집니다.',
      en: '`git switch main` → edit a file → `git add .` → `git commit -m "main work"` → `git merge feature`. With commits on both sides you get a merge commit.',
    },
    check: (state) => state.commits.some((commit) => commit.parents.length > 1),
  },
  {
    id: 'git-rebase',
    title: { ko: 'rebase로 히스토리 정리하기', en: 'Tidy history with rebase' },
    goal: {
      ko: '브랜치에서 git rebase main 을 실행해 커밋을 main 위로 옮겨 보세요.',
      en: 'Run git rebase main on a branch to replay its commits on top of main.',
    },
    hint: {
      ko: '`git switch -c tidy` 로 브랜치를 만들고 커밋을 하나 남긴 다음, `git rebase main` 을 실행하세요. 커밋이 main 위로 다시 쌓입니다.',
      en: 'Create `tidy` with a commit of its own, then run `git rebase main`. The commits are replayed on top of main.',
    },
    check: (state) => state.stats.rebases >= 1,
  },
];

// ── Linux ────────────────────────────────────────────────────────────────────
export interface LinuxMissionState {
  tree: TreeEntry[];
  cwd: string;
  history: string[];
  lastCommand: string;
  lastStdout: string;
}

const findEntry = (tree: TreeEntry[], path: string): TreeEntry | null => {
  const segments = path.split('/').filter(Boolean);
  let level = tree;
  let entry: TreeEntry | null = null;
  for (const segment of segments) {
    entry = level.find((item) => item.name === segment) ?? null;
    if (!entry) return null;
    level = entry.children ?? [];
  }
  return entry;
};

const ran = (state: LinuxMissionState, command: string) =>
  state.history.some((line) => line.trim().split(/\s+/)[0] === command);

export const linuxMissions: Mission<LinuxMissionState>[] = [
  {
    id: 'linux-look',
    title: { ko: '지금 위치와 목록 보기', en: 'Find where you are' },
    goal: {
      ko: 'pwd 로 현재 경로를 확인하고 ls -la 로 숨김 파일까지 살펴보세요.',
      en: 'Use pwd to see where you are and ls -la to list everything, hidden files included.',
    },
    hint: {
      ko: '`pwd` 를 입력하면 /home/learner/work 가 나옵니다. 이어서 `ls -la` 를 입력해 보세요.',
      en: '`pwd` prints /home/learner/work. Then run `ls -la`.',
    },
    check: (state) => ran(state, 'pwd') && ran(state, 'ls'),
  },
  {
    id: 'linux-mkdir',
    title: { ko: '폴더와 파일 만들기', en: 'Create a folder and a file' },
    goal: {
      ko: 'mkdir practice 로 폴더를 만들고 touch practice/todo.txt 로 파일을 만들어 보세요.',
      en: 'Make a folder with mkdir practice, then a file with touch practice/todo.txt.',
    },
    hint: {
      ko: '`mkdir practice` 다음에 `touch practice/todo.txt` 를 입력하세요. 오른쪽 디렉터리 구조에 바로 나타납니다.',
      en: 'Run `mkdir practice`, then `touch practice/todo.txt`. The tree on the right updates immediately.',
    },
    check: (state) => {
      const entry = findEntry(state.tree, '/home/learner/work/practice/todo.txt');
      return entry?.type === 'file';
    },
  },
  {
    id: 'linux-echo',
    title: { ko: '리다이렉트로 파일에 쓰기', en: 'Write to a file with a redirect' },
    goal: {
      ko: 'echo "오늘의 목표" > practice/todo.txt 처럼 > 를 써서 파일에 한 줄을 남겨 보세요.',
      en: 'Use > to put a line into practice/todo.txt, for example echo "today" > practice/todo.txt.',
    },
    hint: {
      ko: '`echo "리눅스 연습" > practice/todo.txt` 를 입력한 뒤 `cat practice/todo.txt` 로 확인해 보세요.',
      en: 'Run `echo "linux practice" > practice/todo.txt`, then check it with `cat practice/todo.txt`.',
    },
    check: (state) => {
      const entry = findEntry(state.tree, '/home/learner/work/practice/todo.txt');
      return entry?.type === 'file' && (entry.content ?? '').trim().length > 0;
    },
  },
  {
    id: 'linux-pipe',
    title: { ko: '파이프로 404 세기', en: 'Count 404s with a pipe' },
    goal: {
      ko: 'cat logs/access.log | grep 404 | wc -l 로 404 응답이 몇 번 있었는지 세어 보세요.',
      en: 'Pipe cat logs/access.log into grep 404 and wc -l to count the 404 responses.',
    },
    hint: {
      ko: '`cat ~/logs/access.log | grep 404 | wc -l` 을 입력하세요. 결과는 숫자 하나로 나옵니다.',
      en: 'Run `cat ~/logs/access.log | grep 404 | wc -l`. The answer is a single number.',
    },
    check: (state) => /^\s*\d+\s*$/.test(state.lastStdout) && state.lastCommand.includes('|') && state.lastCommand.includes('grep'),
  },
  {
    id: 'linux-find',
    title: { ko: '이름으로 파일 찾기', en: 'Find files by name' },
    goal: {
      ko: 'find . -name "*.md" 로 폴더 안의 마크다운 파일을 찾아보세요.',
      en: 'Find the markdown files in this folder with find . -name "*.md".',
    },
    hint: {
      ko: '`find . -name "*.md"` 를 입력하면 notes.md 와 README.md 가 나옵니다.',
      en: '`find . -name "*.md"` lists notes.md and README.md.',
    },
    check: (state) => state.lastCommand.includes('find') && state.lastStdout.includes('notes.md'),
  },
];

// ── Python ───────────────────────────────────────────────────────────────────
export interface PythonMissionState {
  files: Record<string, string>;
  activePath: string;
  lastStdout: string;
  lastStderr: string;
  runs: number;
}

const anyFile = (state: PythonMissionState, test: (code: string) => boolean) =>
  Object.values(state.files).some((code) => test(code));

export const pythonMissions: Mission<PythonMissionState>[] = [
  {
    id: 'py-run',
    title: { ko: '첫 파이썬 실행', en: 'Run your first Python' },
    goal: {
      ko: '실행 버튼이나 Ctrl+Enter 로 hello.py 를 실행해 출력을 확인해 보세요.',
      en: 'Run hello.py with the Run button or Ctrl+Enter and look at the output.',
    },
    hint: {
      ko: '처음 실행할 때는 Pyodide 런타임을 내려받습니다. 진행률이 끝나면 결과 패널에 출력이 나타납니다.',
      en: 'The first run downloads the Pyodide runtime. When the progress bar finishes, the output appears.',
    },
    check: (state) => state.runs >= 1 && state.lastStdout.trim().length > 0,
  },
  {
    id: 'py-fstring',
    title: { ko: 'f-문자열로 소개하기', en: 'Introduce yourself with an f-string' },
    goal: {
      ko: 'hello.py 의 name 을 Vísna Sól 로 바꾸고 f"안녕하세요, {name}입니다." 를 출력해 보세요.',
      en: 'Set name to Vísna Sól in hello.py and print f"안녕하세요, {name}입니다.".',
    },
    hint: {
      ko: '`name = "Vísna Sól"` 로 바꾸고 `print(f"안녕하세요, {name}입니다.")` 를 실행하세요.',
      en: 'Change the line to `name = "Vísna Sól"`, then run `print(f"안녕하세요, {name}입니다.")`.',
    },
    check: (state) => state.lastStdout.includes('안녕하세요, Vísna Sól') && anyFile(state, (code) => /f["']/.test(code)),
  },
  {
    id: 'py-loop',
    title: { ko: '반복문으로 1부터 5까지', en: 'Loop from 1 to 5' },
    goal: {
      ko: 'for 문으로 1부터 5까지 한 줄에 하나씩 출력해 보세요.',
      en: 'Print 1 through 5, one per line, using a for loop.',
    },
    hint: {
      ko: '`for i in range(1, 6):` 아래에 `    print(i)` 를 넣고 실행하세요. 들여쓰기가 중요합니다.',
      en: 'Put `    print(i)` under `for i in range(1, 6):`. Indentation matters.',
    },
    check: (state) => {
      const lines = state.lastStdout.split('\n').map((line) => line.trim());
      return anyFile(state, (code) => /for\s+\w+\s+in\s+/.test(code)) && ['1', '2', '3', '4', '5'].every((n) => lines.includes(n));
    },
  },
  {
    id: 'py-sum',
    title: { ko: '리스트 합계 구하기', en: 'Sum a list' },
    goal: {
      ko: 'numbers.py 에서 리스트 numbers 의 합계 285 를 출력해 보세요.',
      en: 'In numbers.py, print the sum of the numbers list — 285.',
    },
    hint: {
      ko: '`total = sum(numbers)` 다음에 `print(f"합계: {total}")` 를 실행하세요.',
      en: 'Use `total = sum(numbers)` and then `print(f"합계: {total}")`.',
    },
    check: (state) => state.lastStdout.includes('285'),
  },
  {
    id: 'py-function',
    title: { ko: '함수로 평균 구하기', en: 'Average with a function' },
    goal: {
      ko: 'numbers.py 에 average() 함수를 만들고 평균을 소수점 둘째 자리까지(35.63) 출력해 보세요.',
      en: 'Add an average() function to numbers.py and print the mean to two decimals — 35.63.',
    },
    hint: {
      ko: '`def average(values): return sum(values) / len(values)` 를 만들고 `print(f"평균: {average(numbers):.2f}")` 를 실행하세요.',
      en: 'Define `def average(values): return sum(values) / len(values)`, then `print(f"평균: {average(numbers):.2f}")`.',
    },
    check: (state) => state.lastStdout.includes('35.63') && anyFile(state, (code) => /def\s+average\s*\(/.test(code)),
  },
];

// ── SQL ──────────────────────────────────────────────────────────────────────
export interface SqlMissionState {
  tables: SqlTable[];
  last: SqlResult | null;
  lastSql: string;
}

const columnIndex = (result: SqlResult | null, pattern: RegExp) =>
  result ? result.columns.findIndex((column) => pattern.test(column)) : -1;

const employeeRows = (state: SqlMissionState) => state.tables.find((table) => table.name === 'employees')?.rows ?? 0;

export const sqlMissions: Mission<SqlMissionState>[] = [
  {
    id: 'sql-select',
    title: { ko: '직원 전체 조회', en: 'Read every employee' },
    goal: {
      ko: 'SELECT * FROM employees; 로 직원 8명을 모두 조회해 보세요.',
      en: 'Run SELECT * FROM employees; to read all eight employees.',
    },
    hint: {
      ko: '실행 버튼을 누르면 query.sql 의 쿼리가 실행되고 아래 표에 결과가 나옵니다.',
      en: 'Press Run to execute query.sql; the result table appears below.',
    },
    check: (state) => !!state.last && state.last.columns.includes('name') && state.last.rows.length >= 8,
  },
  {
    id: 'sql-where',
    title: { ko: 'WHERE로 걸러내기', en: 'Filter with WHERE' },
    goal: {
      ko: '연봉이 5000 이상인 직원만 골라 보세요.',
      en: 'Select only the employees who earn 5000 or more.',
    },
    hint: {
      ko: '`SELECT name, salary FROM employees WHERE salary >= 5000;` 처럼 조건을 붙입니다.',
      en: 'Add a condition: `SELECT name, salary FROM employees WHERE salary >= 5000;`.',
    },
    check: (state) => {
      if (!state.last) return false;
      const index = columnIndex(state.last, /salary|연봉/i);
      if (index < 0 || state.last.rows.length === 0) return false;
      return state.last.rows.every((row) => Number(row[index]) >= 5000);
    },
  },
  {
    id: 'sql-order',
    title: { ko: '정렬하고 3명만', en: 'Sort and take three' },
    goal: {
      ko: '연봉이 높은 순서로 정렬해 상위 3명만 조회해 보세요.',
      en: 'Order by salary, highest first, and keep only the top three.',
    },
    hint: {
      ko: '`SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 3;`',
      en: '`SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 3;`',
    },
    check: (state) => {
      if (!state.last) return false;
      const index = columnIndex(state.last, /salary|연봉/i);
      if (index < 0 || state.last.rows.length !== 3) return false;
      const values = state.last.rows.map((row) => Number(row[index]));
      return values.every((value, i) => i === 0 || values[i - 1] >= value);
    },
  },
  {
    id: 'sql-group',
    title: { ko: '부서별 평균 연봉', en: 'Average salary per department' },
    goal: {
      ko: 'JOIN 과 GROUP BY 로 부서 이름별 평균 연봉을 구해 보세요.',
      en: 'Join the tables and group by department to get the average salary.',
    },
    hint: {
      ko: '`SELECT d.name, AVG(e.salary) AS avg_salary FROM employees e JOIN departments d ON d.id = e.dept_id GROUP BY d.id, d.name;`',
      en: '`SELECT d.name, AVG(e.salary) AS avg_salary FROM employees e JOIN departments d ON d.id = e.dept_id GROUP BY d.id, d.name;`',
    },
    check: (state) => {
      if (!state.last) return false;
      const avg = columnIndex(state.last, /avg|평균/i);
      return avg >= 0 && state.last.rows.length >= 4 && state.last.rows.every((row) => Number.isFinite(Number(row[avg])));
    },
  },
  {
    id: 'sql-insert',
    title: { ko: '새 직원 추가하기', en: 'Insert a new employee' },
    goal: {
      ko: 'INSERT INTO employees 로 직원을 한 명 더 추가해 보세요.',
      en: 'Add one more employee with INSERT INTO employees.',
    },
    hint: {
      ko: '`INSERT INTO employees (name, dept_id, salary, hired_at) VALUES (\'한지민\', 3, 4700, \'2026-11-21\');` 를 실행한 뒤 다시 조회해 보세요.',
      en: 'Run `INSERT INTO employees (name, dept_id, salary, hired_at) VALUES (\'한지민\', 3, 4700, \'2026-11-21\');`, then select again.',
    },
    check: (state) => employeeRows(state) >= 9,
  },
];
