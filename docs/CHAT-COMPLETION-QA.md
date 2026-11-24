# Chat Completion Stabilization — QA Report (WO-19 ~ WO-28)

- **Repository**: HyangDan2/PKPilot0013
- **Base commit**: `1135b59c22fd31162a33f114049c45c688173ca8`
- **Branch**: `fix/chat-completion-stabilization`
- **Scope**: the Chat Completion lesson only. Python/Git lessons, the IDE shell and markdown lesson
  registration are unchanged.
- **Verified on**: macOS (arm64), Node v24.22.1, headless Chromium (Playwright 1254).

## 1. What changed

| WO | Result | Evidence |
| --- | --- | --- |
| WO-19 API key protection | PASS | Python `safe_request`/`_mask_text`, worker `redactText`/`redactRunText`/`redactTrace`, runner re-mask; Mock Mode sends an empty key; no persisted copy |
| WO-20 Mode-independent checks | PASS | `trace-preview`, `trace-request`, `trace-response`, `trace-stream`, `trace-turns`; the eight missions pass from trace evidence in both modes |
| WO-21 Request preview vs send | PASS | `build_request()` writes a `preview` event only; `chat()`/`stream_chat()` write `request`; the Request tab labels which one is shown |
| WO-22 Live streaming | PASS | `__cpEmit` → worker `delta` → runner `onDelta` → `LiveStream`; Assistant/Streaming tabs grow per chunk; TTFT, chunk count, elapsed; request-id + generation guards |
| WO-23 SSE robustness | PASS (timeout partially) | incremental UTF-8 decoder, CRLF/keep-alive/blank lines, trailing buffer, `[DONE]`/`finish_reason`, abnormal EOF rejected, AbortController cancel, event/byte caps, missing usage shown as N/A |
| WO-24 Run state consistency | PASS | `RunConfigSnapshot` (mode, baseUrl, model, system, user, hash, revision — no key); `staleConfig` marks a run stale after any settings edit |
| WO-25 Live integration QA | PASS | local OpenAI-compatible mock server in Vitest (status codes, malformed bodies, split SSE/Korean, truncated stream, key reflection) + browser CORS allow/deny in Playwright |
| WO-26 Mock engine consistency | PASS | one `estimate_tokens` used for both usage and `max_tokens`; docs state the tokenizer differs and temperature does not change mock sampling; provider-parameter hint on 400/422 |
| WO-27 Lesson improvement | PASS | 8 steps kept; raw HTTP POST example, preview-vs-sent, glossary, streaming comparison exercise, HTTP error/timeout table, security limitation, examples aligned with checks |
| WO-28 Docs & CI | PASS (CI patch by owner) | README panel/check/network updates; `docs/ci-workflow.yml` carries the `@smoke` E2E step; the App token cannot write under `.github/workflows/` |

## 2. Commands run

```text
npm ci
npx tsc --noEmit
npm test                 # 219 tests, 18 files
npm run build            # tsc + vite production build
npm run test:e2e         # Playwright, desktop 1440×900 + mobile 390×844
```

Results: `npm ci` PASS · typecheck PASS · unit **219/219 PASS** (18 files) · build PASS ·
Playwright **27/27 PASS** (desktop 1440×900 + mobile 390×844, ~30 s) · 0 failures, 0 skipped.

## 3. New regression tests

- `tests/chat-live.test.ts` — the lesson's own client against a local OpenAI-compatible server:
  200 + usage, 401/403/404/429/500/503 (with the key echoed by the server), non-JSON body,
  missing `choices`, missing `usage`, key echoed in a success body, SSE split mid-line and
  mid-Hangul with CRLF/chunked bytes, a stream closed without `[DONE]`/`finish_reason`, and
  “no Authorization header when no key is configured”.
- `tests/chat-completion.test.ts` — preview vs sent event kinds, masked trace, and all eight
  missions judged from the real JSONL trace in Mock Mode.
- `tests/session.test.ts` — the key never reaches the worker in Mock Mode; the run snapshot has no
  key; a settings edit flips `staleConfig`/`staleRun`; live stream state is cleared at the end.
- `tests/python-runtime.test.ts` — delta routing/masking, stale request ids, post-done deltas.
- `tests/trace.test.ts` — new event kinds, event cap that keeps Request/Response/Usage/Stream,
  byte cap that drops chunks but keeps the final response, run-text masking.
- `tests/e2e/lessons.spec.ts` — `@smoke` chat run + streaming + stale-on-settings-change, and a
  browser test against a CORS-allowed and a CORS-denied local provider.

## 4. Screenshots

Captured from two `vite preview` builds: the base commit `1135b59` in a worktree (before) and this
branch (after), both at the same lesson and viewport.

| Before (`1135b59`) | After (this branch) |
| --- | --- |
| [before-desktop-chat.png](screenshots/before-desktop-chat.png) — 1440×900, a single non-streaming call; no preview/sent label, no stream summary | [after-desktop-chat.png](screenshots/after-desktop-chat.png) — 1440×900, streaming run with the Stream tab (chunk count, TTFT, elapsed) and the SSE mission completed |
| [before-mobile-chat.png](screenshots/before-mobile-chat.png) — 390×844, mock-only panel | [after-mobile-chat.png](screenshots/after-mobile-chat.png) — 390×844, same panel with zero horizontal overflow |

The Playwright suite also writes per-run captures under `.playwright-artifacts/`
(`pk13-pc-completion.png`, `pk13-mobile-completion.png`, `pk13-landing-*.png`).

## 5. Defects and limitations

1. **Live timeout is not automated end-to-end.** The client stops a non-streaming request at 45 s
   and a stream at 40 s; the runner-level timeout/Stop paths are unit-tested, and Stop is exercised
   in E2E. A 45-second browser case was skipped to keep CI time bounded.
2. **CORS cannot be reproduced outside a browser.** The Vitest suite drives CPython/urllib, which
   ignores CORS; allow/deny is covered by the Playwright case against a local provider only.
3. **Pyodide transport differs internally.** Browser streaming uses `fetch`/`ReadableStream`;
   CPython uses urllib in a thread. Parsing, masking and error handling are the same code and are
   tested on both paths, but byte-level buffering can differ.
4. **User code can read the key.** In Live Mode the key is an environment variable of the running
   Python program; edited code can `os.environ["LLM_API_KEY"]`. The lesson states this limitation.
   Mock Mode never receives the key.
5. **Mock is simulated.** Token counts are `~4 chars / token`, temperature does not sample, and the
   answer is rule-based. This is documented in the lesson.
6. **Lesson body is Korean**, matching the other lessons; mission titles/goals/hints and the UI are
   bilingual (KO/EN).
7. **CI workflow file is a patch.** The assistant token cannot write `.github/workflows/`; the
   owner must copy `docs/ci-workflow.yml` to `.github/workflows/deploy.yml` to run the chat
   `@smoke` E2E in GitHub Actions.
