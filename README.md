# CodePlayground — HD2Lab Lesson IDE

**PKPilot0013** · `https://hyangdan2.github.io/PKPilot0013/`

A reusable, in-browser **lesson IDE** for beginner courses. The landing page is a catalog of
lessons; opening one loads its files, missions and result panels into a single VS Code-style
workspace — reading material on the left, editor in the middle, terminal below, result panels on
the right. Nothing is installed and nothing is uploaded: the whole thing is a static GitHub Pages
bundle.

The IDE shell is written once. A new course is a new markdown file.

## Lessons

| Lesson | Runtime | Panel slots | What the learner does |
| --- | --- | --- | --- |
| **Python Hello World** | Real CPython 3.13 via [Pyodide](https://pyodide.org) (WASM, fetched from jsDelivr on first run) | `output` | Prints, f-strings, a `for` loop and `sum()` — run with the button, `Ctrl+Enter` or `python main.py` |
| **Git Basics** | A purpose-built educational Git engine (in-memory tree snapshots) | `git-graph`, `working-tree` | `init`, `add`, `commit`, `switch -c`, `merge` — watching the commit graph and staging area change |

Both lessons are bilingual (KO/EN) and carry four missions each, plus a free-practice mode.

## How a lesson is defined

`src/lessons/<id>.md` — YAML frontmatter for the sandbox, markdown body for the reading material:

```markdown
---
id: python-hello
order: 1
title: { ko: Python Hello World, en: Python Hello World }
subtitle: { ko: 설치 없이 첫 코드를 실행합니다, en: Run your first code }
runtime: python                 # python | git
panels: [output]                # output | git-graph | working-tree
entry: main.py
files:
  main.py: |
    print("안녕하세요")
missions:
  - id: py-run
    title: { ko: 첫 코드 실행, en: Run your first program }
    goal:  { ko: 실행 버튼을 눌러 보세요, en: Press Run }
    hint:  { ko: 첫 실행은 런타임을 받습니다, en: The first run fetches the runtime }
    check: { type: ran }        # or stdout-contains / stdout-lines / file-matches / git-init / …
---

## 이 강의에서 배우는 것
…
```

- Files are bundled at build time with `import.meta.glob('./lessons/*.md', { query: '?raw' })`, so
  the catalog is the folder listing.
- `panels` decides which cards the right column assembles and in which order
  (`output`, `git-graph`, `working-tree`). Unknown ids fail the build-time parse.
- Mission checks are declarative and evaluated against the live sandbox state after every command:
  `ran`, `stdout-contains`, `stdout-matches`, `stdout-lines`, `file-contains`, `file-matches`,
  `git-init`, `git-commits`, `git-branch`, `git-merge`, or an `all` list of those.
- A broken lesson (unknown runtime/panel, missing entry file, duplicate mission id, bad regex) is
  rejected by `LessonParseError`, and the unit suite parses every bundled lesson.

## Layout

- **Desktop (≥ 1024px)** — four panes: the lesson's markdown and mission checklist (or its file
  explorer) on the left, editor with tabs and line numbers above an interactive terminal in the
  centre, and the mission card plus the lesson's panel slots on the right.
- **Mobile (< 1024px)** — the same four panes as four tabs: **강의·파일 · 에디터 · 터미널 · 결과**,
  with quick-command chips above the terminal. Horizontal overflow is 0 px at 390 × 844.
- The title bar is the HD2Lab standard: logo (back to the catalog) · `KO | EN` · theme · `⋮`.
  Dark (Navy & Lavender) is the default; the iris light theme is one toggle away and remembered.

## Stability guarantees

A pass over the engine and the runtime (WO-01 … WO-06) made three promises explicit, and each one
is covered by a test:

**One source of truth per lesson.** In a Git lesson the repository's working tree is the authority;
`session.files` — what the editor and the file list render — is a projection of it, rewritten after
every command. Switching branches, merging, rebasing, resetting, restoring or removing a file all
move the editor with them, and deleting the open file hands the editor to a file that still exists.

**Nothing the learner typed disappears without a decision.** `checkout`/`switch` carry staged,
unstaged and untracked work across when it does not collide with the target branch, and refuse the
switch (changing nothing) when it would. `merge` refuses to roll over local edits, a conflicted
merge keeps its markers, and `reset --hard` restores tracked files while leaving untracked files
alone. Every command that reports failure restores the whole repository — commits, branches,
index, worktree, counters — from a snapshot taken before it ran.

**A program cannot take the page down with it.** Pyodide runs in a Web Worker, one program at a
time, each with its own namespace and a directory in the interpreter's virtual filesystem (so
`main.py` can `import practice`). Every result carries the request id it was asked with, so a run
from a lesson the learner already left is dropped. Stop terminates the worker, a 20-second timeout
does the same, and a failed CDN download leaves nothing behind for the next try. A run that raised,
hit a `SyntaxError` or was stopped never counts as a finished mission.

**A reload comes back where you were.** Files, the open file, completed missions, the current
mission and — for Git — the repository itself (commits, branches, index, a pending merge) are saved
per lesson and restored on load. Restarting a lesson clears that record and starts from the
markdown again.

A second pass (WO-07 … WO-12) tightened four more edges:

- **`git merge --abort` restores the state the merge started from**, not just HEAD. Staged work,
  unstaged edits and untracked files all come back byte for byte, in the same session and after a
  reload; while a merge is unresolved a second `merge` or a `switch` is refused instead of quietly
  rewriting that snapshot.
- **`git rm` refuses to delete content that exists nowhere else.** A file with staged or unstaged
  modifications is kept and reported; only `-f` / `--force` removes it. A clean tracked file still
  goes without asking, because a commit already holds its content.
- **An edited lesson module is imported fresh.** Each run clears the lesson's modules from
  `sys.modules`, drops earlier run directories from `sys.path` and calls
  `importlib.invalidate_caches()`, so a fixed `practice.py` really takes effect on the next run.
- **The two waits are reported as what they are.** Loading Pyodide has a 30-second limit and running
  the program a 20-second one, and the message names the one that expired. Output carries the
  fingerprint of the files it came from: edit the editor and the old output no longer counts toward
  a mission (the output card says so).
- **An empty workspace is a working workspace.** Every file can be removed (or `git rm`-ed) down to
  zero; that state is saved, restored, and a new file created from it opens straight in the editor.

A third pass (WO-13 … WO-17) closed the remaining correctness gaps:

- **A conflicted merge is a state, not a hint.** The repository records the paths that still hold
  conflicts (`unmergedPaths`), `git status` lists them under *Unmerged paths*, and `git commit`
  refuses while any remain — even when other files are staged, and even with `-a`, which must not
  sweep conflict markers into a commit. `git add` (or `git rm`) on a path is what resolves it; the
  commit that concludes the merge really has two parents. The unresolved state survives save,
  reload and abort.
- **A Python run leaves nothing behind.** Each run's directory is removed from Pyodide's in-memory
  file system in a `finally`, and both PyProxy objects it creates (the namespace dict and the bound
  `dict` factory) are destroyed, so the cost of a lesson does not grow with the number of runs
  (`tools/measure-python-memory.mjs`, 120 runs: 0 directories and 0 MiB of wasm heap).
- **Two tabs never overwrite each other silently.** The saved session carries a `revision` and an
  `updatedAt`; a tab writes only from the revision it read, another tab's newer save arrives over
  `BroadcastChannel` (or a `storage` event), and a tab with unsaved work shows a conflict card —
  *save this tab* or *load the other tab* — instead of racing. A tab with nothing unsaved simply
  follows. Restoring a session on load is unchanged.
- **An older saved session still opens.** A merge saved by a build that had no revisions and no
  pre-merge snapshot is recovered from its conflict markers, still refuses to be committed past, and
  `git merge --abort` warns that it can only reach HEAD while keeping the learner's untracked files.
- **`git rm --cached` matches real git.** The index entry goes, the file stays on disk as an
  untracked file: `git status` shows the staged deletion *and* the untracked file, and `git add`
  puts it back under version control.

The Git lesson's "이 실습 엔진이 단순화한 부분" section lists what the teaching engine deliberately
simplifies (whole-tree snapshots, file-level merge, 8-character hashes, no stash/reflog/remote).

## Development

```bash
npm install
npm run dev        # http://localhost:5173/PKPilot0013/
npm test           # Vitest — parser, panels, checks, Git engine, session, Python protocol
npm run build      # tsc --noEmit && vite build
npm run preview    # http://localhost:4173/PKPilot0013/
npm run test:e2e   # Playwright: catalog → lesson → run, branch switch, reload, stop, 390/1440
```

`tools/measure-python-memory.mjs` measures the cost of a Python lesson over many runs against a
real Pyodide in Node (see the file's header for the two commands); `--legacy` reproduces the
pre-WO-14 lifecycle so the difference is visible.

`PK13_PORT` moves the preview server when 4173 is taken; `PK13_BASE` points the suite at an already
running server (the live site, for example). `--grep @smoke` runs the subset CI requires: those
cases need no network, so a release cannot ship with a broken editor/repository contract.

The Pyodide runtime is the only network request the app makes, and only when a Python lesson is
first run (~10 MB from `cdn.jsdelivr.net`). If it cannot be reached, the output card says so and the
rest of the workspace keeps working.

## Structure

```
src/
  lessons/
    *.md               one lesson each: frontmatter + reading material
    frontmatter.ts     strict YAML-subset + lesson parser (with LessonParseError)
    checks.ts          declarative mission checks against the live state
    index.ts           import.meta.glob catalog
  tracks/
    git/repo.ts        educational Git engine (commands, three-way merge, rebase, reset)
    git/graph.ts       lane/row layout for the commit graph
    git/diff.ts        unified diff + LCS
    python/runner.ts   Pyodide in a Web Worker: one run at a time, ids, stop,
                       separate load/run limits, retry
    python/pyodide.worker.ts  the interpreter itself (message plumbing + runtime loading)
    python/runtime-core.ts    one run: namespace, VFS directory, module reset, always-cleaned-up
    python/module-cache.ts    clears the lesson's modules so an edit is re-imported,
                       and the VFS cleanup Python
  state/session.ts     projection of the working tree, save/restore policy
  state/lesson-state.ts what a mission check may see (and when a run is stale)
  state/useSandbox.ts  lesson ↔ engines ↔ React session, progress persistence
  components/          title bar, landing catalog, lesson doc renderer, sidebar, editor,
                       terminal, mission card, panel slots, git panels
  styles/app.css       Soft Iris / Navy & Lavender IDE skin
tests/                 Vitest suites + Playwright desktop/mobile runs
tools/                 brand asset + OG image generator
```

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main` (type check → unit tests → build) and
publishes `dist/` with GitHub Pages. No `gh-pages` branch is used.

The `@smoke` E2E step belongs in that workflow, but the assistant's GitHub token has no `workflows`
permission, so the file cannot be written from a pull request. The ready-to-install version is kept
at [`docs/ci-workflow.yml`](docs/ci-workflow.yml): copy it over `.github/workflows/deploy.yml` as the
repository owner. Until then CI still type-checks, unit-tests and builds every push.

## License

MIT — see [LICENSE](LICENSE). Third-party components are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
