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

## Development

```bash
npm install
npm run dev        # http://localhost:5173/PKPilot0013/
npm test           # Vitest — frontmatter parser, panel slots, lesson checks, real Python runs
npm run build      # tsc --noEmit && vite build
npm run preview    # http://localhost:4173/PKPilot0013/
npm run test:e2e   # Playwright: 1440×900 catalog → lesson → run, 390×844 tabs
```

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
    python/runner.ts   Pyodide loader with staged progress and offline fallback
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

## License

MIT — see [LICENSE](LICENSE). Third-party components are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
