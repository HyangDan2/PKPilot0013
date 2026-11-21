# Vísna Sól — HD2Lab Coding & CLI Sandbox

**PKPilot0013** · `https://hyangdan2.github.io/PKPilot0013/`

An interactive, four-track coding sandbox that runs entirely in the browser. Learners type real
commands into a VS Code-style IDE — a Git repository with a live commit graph, CPython through
Pyodide, a POSIX-ish shell over an in-memory file system, and SQLite through sql.js — and each
track ships five guided missions that pass only when the real command or program produced the
real result.

Nothing is uploaded and nothing is installed: the whole sandbox is a static GitHub Pages bundle.

## Tracks

| Track | Runtime | What the learner practises |
| --- | --- | --- |
| **Git** | A purpose-built educational Git engine (in-memory tree snapshots) | `init`, `status`, `add`, `commit`, `branch`, `switch`/`checkout`, `merge`, `rebase`, `reset`, `log`, `diff`, `cherry-pick`, `restore`, `rm`, `show` — with an SVG commit graph, HEAD/branch decorations, and working tree / staging state |
| **Python** | Real CPython 3.13 via [Pyodide](https://pyodide.org) (WASM, loaded from jsDelivr on first run) | Strings and f-strings, loops, lists, aggregation, functions — `Ctrl+Enter` or `python <file>.py` |
| **Linux** | A virtual file system with a small shell | `pwd`, `ls`, `cd`, `mkdir`, `touch`, `cat`, `echo`, `cp`, `mv`, `rm`, `grep`, `wc`, `head`, `tail`, `find`, `tree`, pipes (`|`) and redirects (`>`, `>>`) |
| **SQL** | Real SQLite via [sql.js](https://sql.js.org) (wasm served from this origin) | `SELECT`, `WHERE`, `ORDER BY`/`LIMIT`, `JOIN` + `GROUP BY`, `INSERT` — against the bundled `departments` / `employees` / `sales` sample database |

Every track also has **Free Sandbox** mode: no goal, no checks, just the tool.

## Layout

- **Desktop (≥ 1024px)** — four panes: workspace explorer and missions on the left, editor with tabs and line numbers above an interactive terminal in the centre, and the execution output / visualiser (commit graph, directory tree, SQL table and schema, Python stdout) beside the active mission card on the right.
- **Mobile (< 1024px)** — a compact title bar, a mission banner and a four-tab switcher: 파일 (Files) · 코드 (Editor) · 터미널 (Terminal) · 결과 (Output), with quick-command chips above the terminal. Horizontal overflow is 0 px at 390 × 844.

UI copy exists in Korean (존댓말) and English; `KO | EN` switches instantly. Theme follows the HD2Lab
Soft Iris / Navy & Lavender tokens, dark by default, with the choice remembered in `localStorage`.

## Development

```bash
npm install
npm run dev        # http://localhost:5173/PKPilot0013/
npm test           # Vitest — the four engines and all mission checks
npm run build      # tsc --noEmit && vite build (also syncs the sql.js wasm)
npm run preview    # http://localhost:4173/PKPilot0013/
npm run test:e2e   # Playwright (builds + previews on its own)
```

The Pyodide runtime is the only network request the app makes, and only when the Python track is
first run (~10 MB from `cdn.jsdelivr.net`). If it cannot be reached, the Python track says so and
everything else keeps working.

## Structure

```
src/
  tracks/
    git/repo.ts        educational Git engine (commands, three-way merge, rebase, reset)
    git/graph.ts       lane/row layout for the commit graph
    git/diff.ts        unified diff + LCS
    linux/shell.ts     virtual file system, parser, pipes, redirects, completion
    python/runner.ts   Pyodide loader with staged progress and offline fallback
    sql/db.ts          sql.js sandbox, sample database, dot commands
    missions.ts        the twenty missions and their pass checks
  state/useSandbox.ts  engines ↔ React session wiring, progress persistence
  components/          title bar, sidebar, editor, terminal, mission card, visualisers
  styles/app.css       Soft Iris / Navy & Lavender IDE skin
tests/                 Vitest unit suites + Playwright desktop/mobile runs
```

## Deployment

`.github/workflows/deploy.yml` builds on every push to `main` (type check → unit tests → build)
and publishes `dist/` with GitHub Pages. No `gh-pages` branch is used.

## License

MIT — see [LICENSE](LICENSE). Third-party components are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
