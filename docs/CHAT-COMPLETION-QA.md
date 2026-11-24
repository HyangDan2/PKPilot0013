# Chat Completion Stabilization — QA Report (WO-19 ~ WO-35)

- **Repository**: HyangDan2/PKPilot0013
- **Base commit**: `1135b59c22fd31162a33f114049c45c688173ca8`
- **Final QA base**: `f0e9b37` on `fix/chat-completion-stabilization` (PR
  [#9](https://github.com/HyangDan2/PKPilot0013/pull/9))
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
| WO-28 Docs & CI | PASS | README panel/check/network updates; `.github/workflows/deploy.yml` now installs Chromium and runs `npx playwright test --grep @smoke`, which includes the chat Mock/stream/stale and CORS cases |

### Final QA round

| WO | Result | Evidence |
| --- | --- | --- |
| WO-29 Trace data loss | PASS | `parseTrace` reads every line before capping; only chunks are expendable; event **and** byte caps actually apply; `slice(-0)` bug fixed; 1,200-chunk regression keeps Response/Usage/Stream |
| WO-30 Streaming key protection | PASS | Masking is done on the accumulated `StreamRedactor` text, not per delta; `redactValue` masks JSON keys as well as values; split-key, Bearer and provider-echo regressions |
| WO-31 HTTP/SSE timeout & cleanup | PASS | Absolute deadline from connect start; `fetch`/`reader.read`/`response.text` bounded; `AbortController` tied to the real request; reader/connection closed on normal, error and Stop paths; silent/slow-body/stalled-stream regressions |
| WO-32 API settings validation | PASS | Live Mode with an empty Model ID no longer falls back to the mock model; Base URL scheme/host validated; optional-key policy kept; unsupported parameter errors explained |
| WO-33 Mission check correctness | PASS | Next request must replay the previous assistant content; messages verified to accumulate per turn; call counts use completed request/response pairs; missing usage or a differing `finish_reason` no longer blocks a good answer |
| WO-34 Mock stream consistency | PASS | Streaming and non-streaming return the same `finish_reason`; `max_tokens` bounds the estimated `completion_tokens`; the trailing `…` counts toward the budget |
| WO-35 Direct-HTTP practice | PASS | New `http_direct.py` starting file (Endpoint/Header/Payload/POST/parse as TODOs 1–5), clearly separated from the helper example; the 8 missions and IDE shell are unchanged; SSE/error handling kept as advanced material |

## 2. Commands run

```text
npm ci
npx tsc --noEmit
npm test                 # 238 tests, 18 files
npm run build            # tsc + vite production build
npm run test:e2e         # Playwright, desktop 1440×900 + mobile 390×844
```

Results: `npm ci` PASS · typecheck PASS · unit **238/238 PASS** (18 files, WO-19…WO-35) · build PASS ·
Playwright **28/28 PASS** (desktop 1440×900 + mobile 390×844) · 0 failures, 0 skipped.

The E2E run used a separate preview port (`PK13_PORT=4193`) and the cached headless shell
(`PW_CHROMIUM`), no paid API key.

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

Final QA round (WO-29 ~ WO-35):

- `tests/trace.test.ts` — 1,200-chunk flood keeps Response/Usage/Stream (400 events, newest chunk
  kept, under-cap ordering); priority-full cap drops all chunks (`slice(-0)`); a key split across
  `StreamRedactor` pushes is masked, and `StreamRedactor.join` masks the same join; a key echoed as
  a JSON key is masked.
- `tests/chat-live.test.ts` — silent provider, slow body and stalled stream each time out and close
  the server-side socket (short injected timeouts, no paid key); a split-key stream is masked in
  `StreamRedactor.join` while the raw pieces stay in the trace; unsupported-parameter errors are
  explained; Live Mode with an empty model or a malformed/`ftp` Base URL is rejected.
- `tests/chat-completion.test.ts` — mock streaming vs non-streaming consistency (same
  `finish_reason`, same content, `max_tokens` bound incl. `…`, chunk/response agreement); the Python
  trace cap keeps Response/Usage/Stream under a chunk flood; mission-check fixtures cover verbatim
  replay (pass), paraphrased/forgotten replay (fail), failed attempts not counted, and tolerant
  `usage`.
- `tests/python-runtime.test.ts` — cumulative stream deltas replace the shown text instead of
  appending (`cumulative: true`/`false`); existing delta expectation keeps its fields.
- `tests/session.test.ts` — two cumulative deltas replace the live stream text; the stream is
  cleared after the run.
- `tests/lessons.test.ts` — `http_direct.py` ships with TODOs 1–5, `open_url`/`urllib` hints, the
  eight missions are intact, and the body links the practice file.
- `tests/e2e/lessons.spec.ts` — `@smoke` Live Mode against a silent provider and a stalled stream:
  the timeout message appears within ~1 s, the socket is closed, and a split key is masked in the
  stdout and Stream tabs.

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

1. **Live timeouts are now automated, but on short deadlines.** The production client stops a
   non-streaming request at 45 s and a stream at 40 s; the tests inject ~0.4–1 s via
   `LLM_REQUEST_TIMEOUT` / `LLM_STREAM_TIMEOUT` and a browser runtime override, so the deadline,
   abort and cleanup paths are covered without a minute-long CI step. The real 40/45 s values are
   configuration, not separately timed in CI.
2. **A CPython worker thread cannot be force-killed.** The code path aborts and closes the socket,
   and the orphaned `urllib` thread is allowed to unwind, but Python cannot kill a thread; the
   browser transport (used in the app) cancels the `fetch` outright.
3. **CORS cannot be reproduced outside a browser.** The Vitest suite drives CPython/urllib, which
   ignores CORS; allow/deny is covered by the Playwright case against a local provider only.
4. **Pyodide transport differs internally.** Browser streaming uses `fetch`/`ReadableStream`;
   CPython uses urllib in a thread. Parsing, masking and error handling are the same code and are
   tested on both paths, but byte-level buffering can differ.
5. **User code can read the key.** In Live Mode the key is an environment variable of the running
   Python program; edited code can `os.environ["LLM_API_KEY"]`. The lesson states this limitation.
   Mock Mode never receives the key.
6. **Mock is simulated.** Token counts are `~4 chars / token` — not a real tokenizer, so the
   `max_tokens` bound and the reported `completion_tokens` are approximations of the same estimate.
   Temperature does not sample, and the answer is rule-based; this is documented in the lesson.
7. **Lesson body is Korean**, matching the other lessons; mission titles/goals/hints and the UI are
   bilingual (KO/EN).
8. **CI consumes the Pyodide CDN.** The `@smoke` chat case loads the interpreter (~10 MB) from
   `cdn.jsdelivr.net`; a runner without outbound HTTPS would fail that step. It needs no paid API
   key, and the Live Mode cases use a loopback server.
