---
id: chat-completion
order: 3
title:
  ko: LLM Chat Completion 기초
  en: LLM Chat Completion Basics
subtitle:
  ko: Base URL·API Key·Model ID를 직접 넣고 요청 JSON과 응답을 읽으며 대화형 앱을 만듭니다
  en: Bring your own Base URL, key and model, then read the request and response JSON of a chat app
level:
  ko: 기초
  en: Beginner
runtime: python
runTimeout: 60
panels: [completion, output]
entry: main.py
completion:
  mode: mock
  baseUrl: ''
  model: classroom-mock-1
  system: 너는 친절한 파이썬 선생님이야.
  user: 안녕! 너는 누구야?
files:
  llm_client.py: |
    """수업용 OpenAI 호환 Chat Completions 클라이언트.

    Mock Mode 는 네트워크를 쓰지 않고 정해진 규칙으로 응답을 만듭니다.
    Live Mode 는 브라우저의 fetch 로 Base URL 에 실제 요청을 보냅니다. 브라우저가
    아닌 곳(테스트용 CPython)에서는 같은 코드가 urllib 으로 요청합니다.

    Base URL, API Key, Model ID, 프롬프트는 IDE 오른쪽 Chat Completion 패널에서
    입력하고, 실행할 때 환경 변수로 이 파일에 전달됩니다. 그래서 API Key 를
    소스코드나 저장 세션에 적을 필요가 없습니다.

    보안상 한계: 이 파일은 같은 프로세스 안에서 실행되는 학습자 코드이므로,
    학습자가 os.environ["LLM_API_KEY"] 를 직접 읽는 것까지 막을 수는 없습니다.
    키를 출력하거나 다른 곳으로 보내지 마세요.

    이 파일은 강의를 위해 준비된 파일입니다. 고치지 않아도 됩니다.
    """

    import codecs
    import json
    import os
    import socket
    import time
    import urllib.error
    import urllib.request


    def _setting(name, fallback=""):
        value = os.environ.get(f"LLM_{name}", "")
        return value if value != "" else fallback


    MODE = _setting("MODE", "mock")
    BASE_URL = _setting("BASE_URL")
    API_KEY = _setting("API_KEY")
    MODEL = _setting("MODEL", "classroom-mock-1")
    DEFAULT_SYSTEM = _setting("SYSTEM")
    DEFAULT_USER = _setting("USER", "안녕! 너는 누구야?")
    REQUEST_TIMEOUT = 45
    STREAM_TIMEOUT = 40

    TRACE_MAX_EVENTS = 400
    TRACE_MAX_BYTES = 512 * 1024
    _TRACE_KEEP = {"preview", "request", "response", "assistant", "usage", "stream", "error"}

    _trace_events = 0
    _trace_bytes = 0


    def mask_key(key=None):
        """키를 화면에 보여 줄 때 쓰는 가림 처리입니다."""
        value = API_KEY if key is None else key
        if not value:
            return "(비어 있음)"
        if len(value) <= 8:
            return "•" * len(value)
        return value[:4] + "••••" + value[-4:]


    def _mask_text(value):
        """키가 응답·오류 어디에 섞여 있어도 원문이 밖으로 나가지 않게 합니다."""
        text = str(value)
        if API_KEY:
            text = text.replace(API_KEY, mask_key())
        return text


    def endpoint(base_url=None):
        """Base URL 뒤에 /chat/completions 를 붙인 최종 주소."""
        base = (BASE_URL if base_url is None else base_url).rstrip("/")
        if not base:
            return "mock://classroom" if MODE == "mock" else ""
        if base.endswith("/chat/completions"):
            return base
        return base + "/chat/completions"


    def default_messages():
        """패널의 System/User Prompt 로 기본 messages 를 만듭니다."""
        messages = []
        if DEFAULT_SYSTEM:
            messages.append({"role": "system", "content": DEFAULT_SYSTEM})
        messages.append({"role": "user", "content": DEFAULT_USER})
        return messages


    def safe_request(request):
        """요청 dict 의 Authorization 을 가린 복사본을 돌려줍니다.

        그대로 출력하면 키가 화면에 남으므로, 요청을 보여 줄 때는 항상 이
        함수를 쓰세요.
        """
        safe = json.loads(json.dumps(request))
        headers = safe.get("headers", {})
        auth = headers.get("Authorization")
        if auth:
            headers["Authorization"] = "Bearer " + mask_key()
        return safe


    def build_request(messages, *, temperature=None, max_tokens=None, stream=False):
        """HTTP 요청의 주소·헤더·본문을 dict 로 만들고 미리보기를 기록합니다.

        이 함수는 요청을 보내지 않습니다. 미리보기(preview)만 남기므로 HTTP 호출도,
        요금도 없습니다.
        """
        body = {"model": MODEL, "messages": messages}
        if temperature is not None:
            body["temperature"] = temperature
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if stream:
            body["stream"] = True

        headers = {"Content-Type": "application/json"}
        if API_KEY:
            headers["Authorization"] = f"Bearer {API_KEY}"
        request = {"method": "POST", "url": endpoint(), "headers": headers, "body": body}
        _trace("preview", safe_request(request))
        return request


    def estimate_tokens(text):
        """정확한 토크나이저가 아닙니다. 글자 수로 어림합니다 (약 4글자 = 1토큰)."""
        return max(1, (len(text) + 3) // 4)


    def _trace(kind, data):
        """오른쪽 패널이 읽는 기록. 실행이 끝나면 함께 지워집니다."""
        global _trace_events, _trace_bytes
        path = os.environ.get("CP_TRACE_PATH")
        if not path:
            return
        if _trace_events >= TRACE_MAX_EVENTS and kind not in _TRACE_KEEP:
            return
        if _trace_bytes >= TRACE_MAX_BYTES and kind not in _TRACE_KEEP:
            return
        try:
            line = json.dumps({"kind": kind, "data": _mask_data(data)}, ensure_ascii=False)
            if _trace_bytes + len(line.encode("utf-8")) > TRACE_MAX_BYTES and kind not in _TRACE_KEEP:
                return
            with open(path, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")
            _trace_events += 1
            _trace_bytes += len(line.encode("utf-8")) + 1
        except OSError:
            pass


    def _mask_data(value):
        if isinstance(value, str):
            return _mask_text(value)
        if isinstance(value, list):
            return [_mask_data(item) for item in value]
        if isinstance(value, dict):
            return {key: _mask_data(item) for key, item in value.items()}
        return value


    def _mock_content(messages, max_tokens):
        """규칙 기반 가짜 응답.

        temperature 는 Mock 에서 실제 샘플링을 바꾸지 않습니다(같은 입력이면 같은
        답). max_tokens 는 실제 모델처럼 답을 자르고 finish_reason 을 length 로
        바꿉니다. 토큰 수는 estimate_tokens 로 어림하므로 실제 모델의 토크나이저와
        다릅니다.
        """
        assistant_turns = sum(1 for message in messages if message.get("role") == "assistant")
        system = " ".join(
            message.get("content", "")
            for message in messages
            if message.get("role") == "system"
        )
        last_user = ""
        for message in messages:
            if message.get("role") == "user":
                last_user = message.get("content", "")

        prefix = ""
        if assistant_turns > 0:
            prefix += f"[{assistant_turns + 1}번째 턴] "
        if "선생님" in system:
            prefix += "선생님: "

        if "안녕" in last_user and assistant_turns == 0:
            body = (
                f"안녕하세요! 저는 '{MODEL}' 모델로 응답하는 수업용 가짜 챗봇입니다. "
                "무엇을 도와드릴까요?"
            )
        else:
            body = (
                f"'{last_user}'에 대한 모의 응답입니다. "
                "실제 모델이라면 질문에 맞는 답을 만듭니다."
            )
        content = prefix + body

        finish_reason = "stop"
        if max_tokens is not None:
            words = content.split()
            kept = []
            for word in words:
                candidate = " ".join(kept + [word])
                if estimate_tokens(candidate) > max_tokens:
                    break
                kept.append(word)
            if len(kept) < len(words):
                content = " ".join(kept) + " …"
                finish_reason = "length"
            else:
                content = " ".join(kept)
        return content, finish_reason


    def _mock_response(messages, max_tokens):
        content, finish_reason = _mock_content(messages, max_tokens)
        prompt_tokens = sum(
            estimate_tokens(message.get("content", "")) for message in messages
        )
        completion_tokens = estimate_tokens(content)
        return {
            "id": "chatcmpl-classroom-mock",
            "object": "chat.completion",
            "model": MODEL,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": finish_reason,
                }
            ],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
        }


    def _require_live_settings():
        if not BASE_URL:
            raise RuntimeError(
                "Live Mode 에는 Base URL 이 필요합니다. "
                "오른쪽 Chat Completion 패널에서 입력하세요."
            )
        if not MODEL:
            raise RuntimeError(
                "Live Mode 에는 Model ID 가 필요합니다. "
                "오른쪽 Chat Completion 패널에서 입력하세요."
            )


    def _network_error(error):
        return (
            "네트워크 요청이 실패했습니다. 브라우저에서 직접 호출하므로 "
            "제공자가 CORS 를 허용해야 합니다. Base URL 과 HTTPS 주소를 확인하세요. "
            f"({type(error).__name__}: {_mask_text(error)})"
        )


    def _provider_hint(status, message):
        text = _mask_text(message)
        if status in (400, 422) and ("temperature" in text or "max_tokens" in text):
            text += (
                " · 제공자가 이 파라미터를 지원하지 않을 수 있습니다. "
                "파라미터를 빼고 다시 실행해 보세요."
            )
        return text


    def _has_pyodide():
        try:
            import pyodide  # noqa: F401
            return True
        except ImportError:
            return False


    async def _post_json(request):
        """Live Mode 의 일반(비스트리밍) 요청. 브라우저와 CPython 모두 지원."""
        if _has_pyodide():
            from pyodide.http import pyfetch

            response = await pyfetch(
                request["url"],
                method=request["method"],
                headers=request["headers"],
                body=json.dumps(request["body"]),
            )
            text = await response.string()
            return response.status, text

        def blocking():
            data = json.dumps(request["body"]).encode("utf-8")
            req = urllib.request.Request(
                request["url"], data=data, headers=request["headers"], method="POST"
            )
            try:
                with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as response:
                    return response.status, response.read().decode("utf-8", "replace")
            except urllib.error.HTTPError as error:
                return error.code, error.read().decode("utf-8", "replace")

        import asyncio

        return await asyncio.to_thread(blocking)


    def _http_error_message(text, status):
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return None
        error = data.get("error") if isinstance(data, dict) else None
        message = error.get("message") if isinstance(error, dict) else None
        return _provider_hint(status, message if message else str(data)[:200])


    async def chat(messages, *, temperature=1.0, max_tokens=None):
        """messages 를 보내고 chat.completion 응답 dict 를 돌려줍니다."""
        request = build_request(
            messages, temperature=temperature, max_tokens=max_tokens
        )
        _trace("request", safe_request(request))

        if MODE == "mock":
            response = _mock_response(messages, max_tokens)
            _trace("response", response)
            _trace("assistant", response["choices"][0]["message"])
            _trace("usage", response["usage"])
            return response

        _require_live_settings()
        import asyncio

        try:
            status, text = await asyncio.wait_for(
                _post_json(request), timeout=REQUEST_TIMEOUT
            )
        except asyncio.TimeoutError:
            _trace("error", {"status": 0, "message": "요청 시간 초과"})
            raise RuntimeError(
                f"요청이 {REQUEST_TIMEOUT}초 안에 끝나지 않았습니다. "
                "네트워크와 Base URL 을 확인하세요."
            ) from None
        except socket.timeout:
            _trace("error", {"status": 0, "message": "요청 시간 초과"})
            raise RuntimeError(
                f"요청이 {REQUEST_TIMEOUT}초 안에 끝나지 않았습니다. "
                "네트워크와 Base URL 을 확인하세요."
            ) from None
        except Exception as error:
            _trace("error", {"status": 0, "message": _mask_text(error)})
            raise RuntimeError(_network_error(error)) from error

        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            _trace("error", {"status": status, "message": "JSON 이 아닌 응답"})
            raise RuntimeError(
                f"JSON 이 아닌 응답을 받았습니다 (HTTP {status}). Base URL 을 확인하세요."
            ) from None

        if status >= 400 or (isinstance(data, dict) and "error" in data):
            message = _http_error_message(text, status)
            if message is None:
                message = _mask_text(str(data)[:200])
            _trace("error", {"status": status, "message": message})
            raise RuntimeError(f"HTTP {status}: {message}")

        choices = data.get("choices") if isinstance(data, dict) else None
        if not choices:
            _trace("error", {"status": status, "message": "choices 없음"})
            raise RuntimeError(
                "응답에 choices 가 없습니다. OpenAI 호환 chat/completions 응답인지 확인하세요."
            )

        _trace("response", data)
        if data.get("usage"):
            _trace("usage", data["usage"])
        return data


    def parse_sse_line(line):
        """data: 한 줄을 dict 로, [DONE] 은 문자열 'DONE' 으로 바꿉니다.

        빈 줄, 주석(:), event:/id: 줄은 None 입니다. CRLF 는 여기서 정리합니다.
        """
        line = line.rstrip("\r\n").strip()
        if not line or line.startswith(":"):
            return None
        if not line.startswith("data:"):
            return None
        payload = line[5:].strip()
        if payload == "[DONE]":
            return "DONE"
        if not payload:
            return None
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return None


    def _split_sse(buffer):
        """buffer 에서 완성된 줄만 꺼냅니다. CRLF 가 두 조각으로 갈라져도 안전합니다."""
        buffer = buffer.replace("\r\n", "\n")
        if buffer.endswith("\r"):
            # 다음 조각을 기다려야 \r\n 을 제대로 판단할 수 있습니다.
            return [], buffer
        lines = buffer.split("\n")
        return lines[:-1], lines[-1]


    def _first_choice(event):
        choices = event.get("choices") if isinstance(event, dict) else None
        if isinstance(choices, list) and choices:
            return choices[0]
        return {}


    def _decode_chunk(value, decoder):
        try:
            return decoder.decode(bytes(value.to_py()))
        except Exception:
            pass
        try:
            from js import TextDecoder

            return TextDecoder.new().decode(value)
        except Exception:
            return ""


    def _emit(kind, data):
        """브라우저 worker 로 조각을 바로 보냅니다. 테스트(CPython)에서는 무시됩니다."""
        if kind != "delta":
            return
        try:
            from js import __cpEmit

            __cpEmit(kind, json.dumps(data, ensure_ascii=False))
        except Exception:
            pass


    class _StreamState:
        def __init__(self):
            self.content = ""
            self.chunks = []
            self.usage = None
            self.finish_reason = None
            self.done_marker = False
            self.ttft_ms = None


    def _apply_event(event, state, started):
        choice = _first_choice(event)
        delta = choice.get("delta") if isinstance(choice, dict) else None
        piece = delta.get("content") if isinstance(delta, dict) else None
        if piece:
            if state.ttft_ms is None:
                state.ttft_ms = int((time.monotonic() - started) * 1000)
            state.content += piece
            _emit("delta", {"content": piece})
        if isinstance(choice, dict) and choice.get("finish_reason"):
            state.finish_reason = choice["finish_reason"]
        if isinstance(event, dict) and event.get("usage"):
            state.usage = event["usage"]
        state.chunks.append(event)
        _trace("chunk", event)


    def _finish_stream(state, started):
        data = {
            "id": "chatcmpl-stream",
            "object": "chat.completion",
            "model": MODEL,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": state.content},
                    "finish_reason": state.finish_reason or "stop",
                }
            ],
            "chunks": state.chunks,
        }
        if state.usage:
            data["usage"] = state.usage
        elapsed = int((time.monotonic() - started) * 1000)
        _trace(
            "stream",
            {
                "chunks": len(state.chunks),
                "ttftMs": state.ttft_ms,
                "done": True,
                "finishReason": state.finish_reason or "stop",
                "ms": elapsed,
            },
        )
        _trace("response", {key: value for key, value in data.items() if key != "chunks"})
        if state.usage:
            _trace("usage", state.usage)
        return data


    async def _mock_stream(messages, max_tokens):
        response = _mock_response(messages, max_tokens)
        content = response["choices"][0]["message"]["content"]
        words = content.split(" ")
        state = _StreamState()
        started = time.monotonic()
        import asyncio

        for index, word in enumerate(words):
            piece = word + (" " if index < len(words) - 1 else "")
            event = {"choices": [{"index": 0, "delta": {"content": piece}}]}
            _apply_event(event, state, started)
            await asyncio.sleep(0.01)

        data = _finish_stream(state, started)
        data["chunks"] = state.chunks
        return data


    def _stream_lines(buffer, final, state, started):
        lines, remainder = _split_sse(buffer)
        if final and remainder.strip():
            lines = lines + [remainder]
            remainder = ""
        for line in lines:
            event = parse_sse_line(line)
            if event is None:
                continue
            if event == "DONE":
                state.done_marker = True
                continue
            _apply_event(event, state, started)
        return remainder


    def _ensure_complete(state):
        if state.done_marker or state.finish_reason is not None:
            return
        raise RuntimeError(
            "스트림이 [DONE] 이나 finish_reason 없이 끊겼습니다. "
            "응답이 잘렸을 수 있으니 다시 실행해 보세요."
        )


    async def _browser_live_stream(request):
        from js import JSON as JsJSON
        from js import AbortController, fetch

        controller = AbortController.new()
        init = JsJSON.parse(
            json.dumps(
                {
                    "method": "POST",
                    "headers": request["headers"],
                    "body": json.dumps(request["body"]),
                }
            )
        )
        init.signal = controller.signal
        try:
            response = await fetch(request["url"], init)
        except Exception as error:
            raise RuntimeError(_network_error(error)) from error

        if not response.ok:
            text = await response.text()
            message = _http_error_message(text, response.status)
            _trace("error", {"status": response.status, "message": message or text[:300]})
            controller.abort()
            raise RuntimeError(f"HTTP {response.status}: {message or _mask_text(text)[:300]}")

        reader = response.body.getReader()
        decoder = codecs.getincrementaldecoder("utf-8")()
        state = _StreamState()
        started = time.monotonic()
        buffer = ""
        deadline = started + STREAM_TIMEOUT

        try:
            while not state.done_marker:
                if time.monotonic() > deadline:
                    raise RuntimeError(
                        f"스트리밍이 {STREAM_TIMEOUT}초 안에 끝나지 않았습니다. "
                        "Stop 을 누르거나 Base URL 을 확인하세요."
                    )
                result = await reader.read()
                if result.done:
                    buffer += decoder.decode(b"", final=True)
                    buffer = _stream_lines(buffer, True, state, started)
                    break
                buffer += _decode_chunk(result.value, decoder)
                buffer = _stream_lines(buffer, False, state, started)
            _ensure_complete(state)
        except Exception:
            # Close the real HTTP connection instead of leaving it hanging.
            controller.abort()
            raise

        return _finish_stream(state, started)


    async def _cpython_live_stream(request):
        """CPython(테스트·명령줄)에서 같은 SSE 코드를 쓰기 위한 전송 계층."""
        import asyncio

        def blocking():
            data = json.dumps(request["body"]).encode("utf-8")
            req = urllib.request.Request(
                request["url"], data=data, headers=request["headers"], method="POST"
            )
            try:
                return urllib.request.urlopen(req, timeout=STREAM_TIMEOUT)
            except urllib.error.HTTPError as error:
                body = error.read().decode("utf-8", "replace")
                raise RuntimeError(f"HTTP {error.code}: {_http_error_message(body, error.code) or _mask_text(body)[:300]}")

        response = await asyncio.to_thread(blocking)
        decoder = codecs.getincrementaldecoder("utf-8")()
        state = _StreamState()
        started = time.monotonic()
        buffer = ""
        deadline = started + STREAM_TIMEOUT

        try:
            while not state.done_marker:
                if time.monotonic() > deadline:
                    raise RuntimeError(
                        f"스트리밍이 {STREAM_TIMEOUT}초 안에 끝나지 않았습니다. "
                        "Stop 을 누르거나 Base URL 을 확인하세요."
                    )
                piece = await asyncio.to_thread(response.read, 256)
                if not piece:
                    buffer += decoder.decode(b"", final=True)
                    buffer = _stream_lines(buffer, True, state, started)
                    break
                buffer += decoder.decode(piece)
                buffer = _stream_lines(buffer, False, state, started)
            _ensure_complete(state)
        finally:
            response.close()

        return _finish_stream(state, started)


    async def stream_chat(messages, *, temperature=1.0, max_tokens=None):
        """SSE 조각을 모아 하나의 assistant 응답으로 돌려줍니다."""
        request = build_request(
            messages, temperature=temperature, max_tokens=max_tokens, stream=True
        )
        _trace("request", safe_request(request))
        if MODE == "mock":
            return await _mock_stream(messages, max_tokens)
        _require_live_settings()
        if _has_pyodide():
            return await _browser_live_stream(request)
        return await _cpython_live_stream(request)
  main.py: |
    """Mission 1 — 연결 설정 확인하기.

    오른쪽 Chat Completion 패널의 값을 읽어 봅니다.
    아직 네트워크 요청은 보내지 않습니다.
    """

    import llm_client

    print("mode:", llm_client.MODE)
    print("base url:", llm_client.endpoint())
    print("model:", llm_client.MODEL)
    print("api key:", llm_client.mask_key())
    print("system:", llm_client.DEFAULT_SYSTEM or "(없음)")
    print("user:", llm_client.DEFAULT_USER)

  chatbot.py: |
    """Mission 8 — 간단한 챗봇 (자유 실습).

    아래 TODO 를 채워 3턴 대화를 완성하세요.
    실행: 터미널에 python chatbot.py

    힌트에 완성 예시가 있습니다.
    """

    from llm_client import stream_chat

    messages = []

    # TODO 1: system 메시지로 챗봇의 역할을 정하세요.
    # TODO 2: 첫 user 메시지를 넣고 stream_chat 으로 답을 받으세요.
    # TODO 3: 첫 답을 messages 에 넣고 두 번째 질문을 이어 가세요.
    # TODO 4: 마지막에 print("[chatbot]", ...) 로 결과를 확인하세요.

missions:
  - id: chat-settings
    title:
      ko: 연결 설정 확인
      en: Read the connection settings
    goal: |
      오른쪽 패널의 Base URL·API Key·Model ID 와 프롬프트가 어떻게 Python 으로 전달되는지 main.py 에서 확인하고 실행하세요.
    hint: |
      main.py 는 지금 그대로 실행해도 됩니다. mode: mock, base url: mock://classroom, model: classroom-mock-1, api key: (비어 있음) 이 보이면 성공입니다. 패널에서 System Prompt 를 바꾸면 마지막 system 줄이 바뀌고, Mock Mode 는 네트워크를 전혀 쓰지 않습니다.
    check:
      - type: stdout-contains
        value: 'mode:'
      - type: stdout-contains
        value: 'base url:'
      - type: stdout-contains
        value: 'model:'
      - type: stdout-contains
        value: 'api key:'
  - id: chat-request
    title:
      ko: 요청 JSON 만들기
      en: Build the request JSON
    goal: |
      build_request 로 method·URL·header·body 를 만들고, body 에 messages 와 temperature 가 들어가는 것을 확인하세요.
    hint: |
      본문 Mission 2 의 예제를 main.py 에 그대로 옮겨 실행하세요. build_request() 는 요청을 보내지 않고 preview 만 남깁니다. Request JSON 탭에서 요청 구조를, 출력에서 safe_request() 로 가린 헤더를 확인하세요.
    check:
      - type: file-matches
        path: main.py
        value: 'build_request\s*\('
      - type: trace-preview
        messages: [system, user]
        temperature: 0.7
        maxTokens: 200
  - id: chat-first-call
    title:
      ko: 첫 Chat Completion 호출
      en: Make the first call
    goal: |
      await chat(default_messages()) 로 첫 요청을 보내고 assistant 메시지를 출력하세요.
    hint: |
      본문 Mission 3 의 예제처럼 main.py 를 바꾸고 실행하세요. chat() 은 async 함수라 await 가 필요합니다. 응답 본문은 response["choices"][0]["message"]["content"] 에 있습니다. 실행이 끝나면 Assistant 탭과 Response JSON 탭에 결과가 모입니다.
    check:
      - type: file-matches
        path: main.py
        value: 'await\s+chat\('
      - type: trace-request
        messages: [system, user]
      - type: trace-response
        assistant: true
  - id: chat-response
    title:
      ko: 응답 JSON 파싱
      en: Parse the response
    goal: |
      choices[0] 에서 role·finish_reason·content 를 꺼내고 usage 의 토큰 수를 읽으세요.
    hint: |
      본문 Mission 4 의 예제를 사용하세요. choice = response["choices"][0] 으로 첫 후보를 고른 뒤 role·finish_reason·content 를 출력하고, usage 의 total_tokens 를 읽습니다. Mock Mode 도 같은 구조의 응답을 돌려줍니다.
    check:
      - type: file-matches
        path: main.py
        value: 'choices.{0,4}\[0\]'
      - type: trace-response
        finish: stop
        usage: true
        assistant: true
  - id: chat-roles
    title:
      ko: 역할과 멀티턴 대화
      en: Roles and multi-turn chat
    goal: |
      system 으로 역할을 정하고, 첫 assistant 답을 messages 에 append 해 두 번째 질문을 이어 가세요.
    hint: |
      본문 Mission 5 의 예제를 사용하세요. messages 에 system·user 를 넣고 첫 호출을 합니다. 그다음 first["choices"][0]["message"] 를 messages 에 append 하고 새 user 메시지를 붙여 다시 호출합니다. API 는 이전 대화를 기억하지 않으므로 매번 전체 messages 를 보내야 합니다. 판정은 응답 문구가 아니라, 두 번째 요청의 messages 에 이전 assistant 답이 들어 있는지로 합니다.
    check:
      - type: file-matches
        path: main.py
        value: 'append\s*\('
      - type: file-matches
        path: main.py
        value: '"system"'
      - type: trace-turns
        min: 2
        assistantReuse: true
  - id: chat-parameters
    title:
      ko: temperature와 max_tokens
      en: Control temperature and max_tokens
    goal: |
      temperature 를 0.2 로, max_tokens 를 5 로 보내고 finish_reason 이 length 로 바뀌는지 확인하세요.
    hint: |
      본문 Mission 6 의 예제를 사용하세요. chat(messages, temperature=0.2, max_tokens=5) 처럼 두 값을 직접 넘깁니다. 판정은 요청 파라미터(temperature·max_tokens)와 응답의 finish_reason 을 따로 확인합니다. 실제 모델도 5토큰에서 답이 길면 length 로 끝납니다.
    check:
      - type: file-matches
        path: main.py
        value: 'temperature\s*=\s*0\.2'
      - type: file-matches
        path: main.py
        value: 'max_tokens\s*=\s*5'
      - type: trace-request
        temperature: 0.2
        maxTokens: 5
      - type: trace-response
        finish: length
  - id: chat-stream
    title:
      ko: SSE 스트리밍 처리
      en: Handle an SSE stream
    goal: |
      stream_chat 으로 조각을 모아 assistant 메시지를 만들고, Streaming 탭에서 조각을 확인하세요.
    hint: |
      본문 Mission 7 의 예제를 사용하세요. stream_chat 은 stream=True 요청을 보내고 data: 줄을 하나씩 읽어 delta.content 를 이어 붙입니다. 실행 중에는 조각이 도착하는 대로 Assistant·Streaming 탭이 갱신되고, 첫 조각까지 걸린 시간과 조각 수가 표시됩니다.
    check:
      - type: file-matches
        path: main.py
        value: 'stream_chat\s*\('
      - type: trace-request
        stream: true
      - type: trace-stream
        minChunks: 2
        done: true
        assistant: true
  - id: chat-chatbot
    title:
      ko: 자유 실습 — 챗봇
      en: Free practice — a chatbot
    goal: |
      chatbot.py 의 TODO 를 채워 system 역할을 가진 3턴 대화를 완성하고, [chatbot] 으로 시작하는 결과를 출력하세요.
    hint: |
      본문 Mission 8 의 완성 예시를 chatbot.py 에 옮기세요. system 메시지로 역할을 정하고, stream_chat 으로 첫 답을 받은 뒤 그 assistant 메시지와 새 user 메시지를 messages 에 append 하는 일을 세 번 반복합니다. 판정은 세 번의 요청과 assistant 답 재사용으로 합니다. 터미널에 python chatbot.py 를 입력하거나 파일을 연 뒤 실행하세요.
    check:
      - type: file-matches
        path: chatbot.py
        value: 'stream_chat\s*\('
      - type: file-matches
        path: chatbot.py
        value: '"system"'
      - type: trace-turns
        min: 3
        assistantReuse: true
      - type: trace-stream
        done: true
        minChunks: 2
      - type: stdout-contains
        value: '[chatbot]'

---

## 이 강의에서 만드는 것

ChatGPT 같은 앱의 가장 작은 뼈대는 **chat completion API 호출** 하나입니다. 이 강의에서는 Base URL, API Key, Model ID를 직접 넣고, HTTP 요청과 JSON 응답을 눈으로 읽으면서 대화형 앱을 만듭니다.

- 처음에는 **Mock Mode** 로 연습합니다. 네트워크도, API Key도, 요금도 필요 없습니다.
- 준비가 되면 **Live Mode** 로 바꿔 실제 OpenAI 호환 제공자에 연결할 수 있습니다.
- 오른쪽 **Chat Completion** 패널에서 요청·응답·assistant 메시지·토큰 사용량·스트리밍 조각을 확인합니다.

> 이 강의의 Python 은 브라우저 안의 진짜 CPython(Pyodide)에서 실행됩니다. 코드와 파일은 서버로 보내지 않습니다.

## 준비: 연결 패널 읽기

오른쪽 Chat Completion 패널에는 다섯 가지 입력이 있습니다.

| 입력 | 의미 | Mock Mode |
| --- | --- | --- |
| Base URL | 제공자의 API 주소. 보통 `/v1` 로 끝납니다 | 필요 없음 |
| API Key | 인증 키. `Authorization: Bearer …` 로 전송됩니다 | 필요 없음 |
| Model ID | 사용할 모델 이름 | 연습용 이름을 그대로 표시 |
| System Prompt | 모델의 역할·말투를 정하는 지시문 | 응답 앞에 반영 |
| User Prompt | 이번에 물어볼 내용 | 응답의 재료 |

두 실행 모드의 차이는 분명합니다.

| | Mock Mode (기본) | Live Mode |
| --- | --- | --- |
| 네트워크 | 사용하지 않음 | 브라우저에서 직접 HTTP 요청 |
| API Key | 필요 없음 | 제공자에 따라 필요 |
| 응답 | 수업용 규칙 기반 가짜 응답 | 실제 모델의 응답 |
| 요금 | 없음 | 제공자 정책에 따름 |
| CORS | 상관없음 | 서버가 허용해야 함 |

**API Key는 메모리에서만 관리합니다.** 패널에 입력한 키는 실행할 때 Python으로 전달되고, 실행이 끝나면 지워집니다. 저장 세션, 소스코드, 요청 기록에는 남지 않으며 Request JSON의 Authorization 헤더는 마스킹됩니다. **Mock Mode에서는 키를 Python 실행 환경으로 아예 넘기지 않습니다.** 연습에는 키가 필요 없기 때문입니다.

> **보안상 한계**: Live Mode에서 키는 실행 중인 Python 프로세스의 환경 변수로 들어갑니다. 학습자가 코드를 자유롭게 고칠 수 있으므로 `os.environ["LLM_API_KEY"]` 를 출력하는 코드를 직접 작성하면 키를 볼 수 있습니다. 이 강의의 자동 판정과 기록은 키를 가리지만, **실제 서비스에서는 API Key를 브라우저로 보내지 말고 서버에서 보관**하세요.

**용어 정리**

| 용어 | 뜻 | 이 강의에서 |
| --- | --- | --- |
| API Key | 제공자가 앱을 식별하는 비밀 문자열 | 패널에서 입력, 메모리에서만 사용 |
| JSON | 키·값으로 이루어진 텍스트 데이터 형식 | 요청 본문과 응답 모두 JSON |
| HTTP 상태 코드 | 요청 결과를 나타내는 숫자 | 200 성공, 401/403 인증·권한, 404 주소, 429 한도, 5xx 서버 |
| CORS | 브라우저가 다른 출처로 요청할 때 서버가 허용해야 하는 규칙 | Live Mode에서 필요한 경우 오류 발생 |
| SSE | 서버가 `data:` 한 줄씩 응답을 흘려보내는 방식 | 스트리밍 응답 |
| chunk / delta | 스트림에서 도착하는 작은 조각 | `choices[0].delta.content` |


## 1. Base URL, API Key, Model ID

OpenAI 호환 chat completion의 주소는 보통 다음과 같습니다.

```text
POST {Base URL}/chat/completions
Authorization: Bearer {API Key}
Content-Type: application/json
```

Base URL은 제공자마다 다릅니다. `https://api.example.com/v1` 처럼 버전 경로까지 포함하는 경우가 많습니다. 특정 제공자나 모델을 코드에 하드코딩하지 않고, 항상 패널에서 받은 값을 씁니다.

`llm_client.py` 의 `endpoint()` 는 Base URL 끝의 `/` 를 정리하고 `/chat/completions` 를 붙입니다. `mask_key()` 는 키를 `sk-a••••wxyz` 처럼 가립니다.

### Mission 1 — 연결 설정 확인

**개념** 설정은 코드가 아니라 실행 환경으로 들어옵니다.

**예제 코드** (`main.py`)

```python
import llm_client

print("mode:", llm_client.MODE)
print("base url:", llm_client.endpoint())
print("model:", llm_client.MODEL)
print("api key:", llm_client.mask_key())
print("system:", llm_client.DEFAULT_SYSTEM or "(없음)")
print("user:", llm_client.DEFAULT_USER)
```

**실습 과제** 그대로 실행한 뒤, 패널의 System Prompt를 바꾸고 다시 실행해 `system:` 줄이 바뀌는지 확인하세요.

**완료 조건** `mode:`, `base url:`, `model:`, `api key:` 가 출력되면 완료입니다.

## 2. HTTP Header와 JSON Request

chat completion 요청의 본문은 다음 모양입니다.

```json
{
  "model": "classroom-mock-1",
  "messages": [
    {"role": "system", "content": "너는 친절한 파이썬 선생님이야."},
    {"role": "user", "content": "안녕! 너는 누구야?"}
  ],
  "temperature": 0.7,
  "max_tokens": 200
}
```

- `model`: 패널의 Model ID
- `messages`: 역할(`role`)과 내용(`content`)의 목록
- `temperature`, `max_tokens`: 선택 파라미터
- `stream`: 스트리밍을 받을 때 `true`

`build_request()` 는 이 dict를 만들고, 키가 있을 때만 Authorization 헤더를 넣습니다.

**미리보기(preview)와 실제 전송(sent)은 다릅니다.** `build_request()` 는 요청을 만들기만 하고 **HTTP 호출을 하지 않습니다.** 그래서 실행해도 네트워크도, 요금도 없습니다. Request JSON 탭에 `미리보기`라고 표시됩니다. `chat()` 이나 `stream_chat()` 처럼 실제로 보낸 요청은 `전송됨`으로 표시되고, 같은 요청이라도 미리보기와 전송 기록이 따로 남습니다.

### 참고: HTTP POST를 직접 구현하면

`llm_client._post_json()` 이 하는 일은 결국 POST 한 번입니다. 원리를 확인하고 싶다면 아래처럼 직접 보내 볼 수 있습니다. (실행 환경이 브라우저인지에 따라 전송 도구만 다릅니다.)

```python
import json
import llm_client

request = llm_client.build_request(llm_client.default_messages())
try:
    from pyodide.http import pyfetch
    response = await pyfetch(
        request["url"],
        method="POST",
        headers=request["headers"],
        body=json.dumps(request["body"]),
    )
    print(response.status, await response.string())
except ImportError:  # CPython
    import urllib.request
    data = json.dumps(request["body"]).encode("utf-8")
    call = urllib.request.Request(request["url"], data=data, headers=request["headers"], method="POST")
    with urllib.request.urlopen(call, timeout=45) as response:
        print(response.status, response.read().decode("utf-8"))
```

실습에서는 직접 전송 코드를 쓰지 않고, 오류 처리와 스트리밍까지 들어 있는 `chat()`·`stream_chat()` 을 사용합니다.

### Mission 2 — 요청 JSON 만들기

**개념** 요청을 보내기 전에 주소·헤더·본문을 직접 만들어 봅니다.

**예제 코드** (`main.py`)

```python
import json
from llm_client import build_request, default_messages

request = build_request(default_messages(), temperature=0.7, max_tokens=200)
print("method:", request["method"])
print("url:", request["url"])
print(json.dumps(request["headers"], ensure_ascii=False, indent=2))
print(json.dumps(request["body"], ensure_ascii=False, indent=2))
```

**실습 과제** 출력에서 `model`, `messages`, `temperature`, `max_tokens` 를 찾아보세요. Request JSON 탭의 헤더가 어떻게 가려지는지도 확인하세요.

**완료 조건** 출력에 `"messages"` 와 `"temperature": 0.7` 이 있고, `main.py` 가 `build_request(` 를 호출하면 완료입니다.

## 3. Chat Completion API 호출

`chat()` 은 `async` 함수입니다. 브라우저의 네트워크 요청은 기다려야 하므로 `await` 를 붙입니다. Pyodide의 최상위 코드에서도 `await` 를 바로 쓸 수 있습니다.

성공 응답은 다음 모양입니다.

```json
{
  "id": "chatcmpl-…",
  "object": "chat.completion",
  "model": "…",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "…"},
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 21, "completion_tokens": 17, "total_tokens": 38}
}
```

**오류와 시간 초과**도 정상적인 응답의 일부입니다. `chat()` 은 다음 경우에 `RuntimeError` 를 내고, 오른쪽 패널의 Error 기록에 상태 코드와 가린 메시지를 남깁니다.

| 상황 | 화면에 보이는 메시지(요약) | 확인할 것 |
| --- | --- | --- |
| 401 / 403 | `HTTP 401: …` | API Key가 맞는지 |
| 404 | `HTTP 404: …` | Base URL 경로 (`/v1` 등) |
| 429 | `HTTP 429: …` | 사용 한도·잠시 후 재시도 |
| 5xx | `HTTP 500/503: …` | 제공자 상태, 잠시 후 재시도 |
| JSON 아님 | `JSON 이 아닌 응답을 받았습니다` | Base URL이 API 주소인지 |
| `choices` 없음 | `응답에 choices 가 없습니다` | OpenAI 호환 응답인지 |
| 네트워크 실패 | `네트워크 요청이 실패했습니다 … CORS` | CORS·HTTPS·주소 |

```python
from llm_client import chat, default_messages

try:
    response = await chat(default_messages())
except RuntimeError as error:
    # 이미 키가 가려진, 사람이 읽을 수 있는 메시지입니다.
    print("요청 실패:", error)
else:
    print("assistant:", response["choices"][0]["message"]["content"])
```

`chat()` 은 45초, `stream_chat()` 은 40초가 지나면 스스로 멈춥니다. 그래도 멈추지 않으면 아래 **중단** 버튼을 누르세요. 중단은 Python worker를 종료하므로 다음 실행은 새 환경에서 시작합니다.

### Mission 3 — 첫 Chat Completion 호출

**개념** 요청을 보내고 assistant의 답을 꺼냅니다.

**예제 코드** (`main.py`)

```python
from llm_client import chat, default_messages

response = await chat(default_messages())
message = response["choices"][0]["message"]
print("assistant:", message["content"])
```

**실습 과제** 실행한 뒤 Response JSON 탭에서 `object` 가 `chat.completion` 인지 확인하세요.

**완료 조건** `assistant:` 뒤에 답이 출력되고, `main.py` 에 `await chat(` 이 있으면 완료입니다.

## 4. Response JSON 파싱

응답에서 꼭 읽는 값은 다음과 같습니다.

| 위치 | 값 | 의미 |
| --- | --- | --- |
| `choices[0].message.role` | `assistant` | 답을 만든 주체 |
| `choices[0].message.content` | 문자열 | 화면에 보여 줄 답 |
| `choices[0].finish_reason` | `stop` 또는 `length` | 끝난 이유 |
| `usage.prompt_tokens` | 숫자 | 보낸 메시지의 토큰 수 |
| `usage.completion_tokens` | 숫자 | 받은 답의 토큰 수 |
| `usage.total_tokens` | 숫자 | 합계 |

`finish_reason` 이 `length` 면 `max_tokens` 때문에 답이 잘린 것입니다. 오류 응답은 보통 `error.message` 에 이유가 들어 있습니다.

### Mission 4 — 응답 JSON 파싱

**개념** 필요한 필드만 골라 읽습니다.

**예제 코드** (`main.py`)

```python
from llm_client import chat, default_messages

response = await chat(default_messages(), temperature=0.2, max_tokens=200)
choice = response["choices"][0]
print("role:", choice["message"]["role"])
print("finish_reason:", choice["finish_reason"])
print("content:", choice["message"]["content"])
print("usage:", response["usage"])
```

**실습 과제** Usage 탭과 출력의 토큰 수를 비교하세요. Mock Mode의 토큰 수는 글자 수로 어림한 값입니다.

**완료 조건** `role: assistant`, `finish_reason: stop`, `total_tokens` 가 출력되고, 응답 기록에 `choices`·`usage`·assistant 메시지가 남으면 완료입니다.

## 5. System / User / Assistant와 멀티턴

메시지의 세 역할은 다음과 같습니다.

| role | 누가 쓰나 | 쓰임 |
| --- | --- | --- |
| `system` | 앱 개발자 | 모델의 역할·말투·규칙 |
| `user` | 사용자 | 질문·요청 |
| `assistant` | 모델 | 이전 답. 다음 요청에 다시 넣어 대화를 이어 감 |

**API는 대화를 기억하지 않습니다.** 두 번째 요청에도 system과 이전 user/assistant 메시지를 전부 다시 보내야 합니다. 그래서 `messages.append(...)` 가 멀티턴의 핵심입니다.

### Mission 5 — 역할과 멀티턴 대화

**개념** 첫 답을 `assistant` 메시지로 다시 넣고 두 번째 질문을 이어 갑니다.

**예제 코드** (`main.py`)

```python
from llm_client import chat

messages = [
    {"role": "system", "content": "너는 초등학생에게 설명하는 선생님이야."},
    {"role": "user", "content": "안녕! 너는 누구야?"},
]
first = await chat(messages)
messages.append(first["choices"][0]["message"])
messages.append({"role": "user", "content": "방금 뭐라고 했어?"})
second = await chat(messages)
print("second turn:", second["choices"][0]["message"]["content"])
```

**실습 과제** 두 번째 호출 뒤 `messages` 를 출력해 system·user·assistant·user 순서가 되는지 확인하세요.

**완료 조건** 출력에 `2번째 턴` 이 있고, `main.py` 에 `append(` 와 `"system"` 이 있으면 완료입니다.

## 6. temperature와 max_tokens

| 파라미터 | 뜻 | 낮으면 | 높으면 |
| --- | --- | --- | --- |
| `temperature` | 답의 무작위성 | 같은 질문에 비슷한 답 | 다양하고 창의적인 답 |
| `max_tokens` | 답의 최대 토큰 수 | 짧고 잘릴 수 있음 | 길게 생성 |

`temperature` 는 Mock Mode에서 흉내만 냅니다. `max_tokens` 는 실제로 답을 자르고 `finish_reason` 을 `length` 로 바꿉니다.

**Mock Mode가 실제 모델과 같은 점과 다른 점**

- 같은 점: 응답 구조(`choices`, `usage`, `finish_reason`), `max_tokens` 로 답이 잘리는 동작, SSE 조각 형식.
- 다른 점: 토큰 수를 **약 4글자 = 1토큰**으로 어림합니다(`estimate_tokens`). 실제 모델의 토크나이저와 값이 다릅니다. 같은 어림값을 `max_tokens` 자르기에도 쓰므로 Mock 안에서는 앞뒤가 맞습니다.
- `temperature` 는 Mock에서 **샘플링을 바꾸지 않습니다.** 같은 입력이면 같은 답이 나옵니다. 실제 모델에서만 무작위성에 영향을 줍니다.
- `top_p`, `stop`, `response_format` 처럼 제공자마다 지원 여부가 다른 파라미터는 `chat()` 이 보내지 않습니다. 실제 제공자에서 이 파라미터를 직접 추가했다가 `400/422` 가 나오면 "제공자가 이 파라미터를 지원하지 않을 수 있습니다" 안내가 함께 표시됩니다. 파라미터를 빼고 다시 시도하세요.

### Mission 6 — temperature와 max_tokens

**개념** 두 파라미터를 요청에 직접 넣고 결과가 달라지는지 봅니다.

**예제 코드** (`main.py`)

```python
from llm_client import chat

messages = [{"role": "user", "content": "LLM 앱에서 API 키는 어디에 두어야 해?"}]
response = await chat(messages, temperature=0.2, max_tokens=5)
choice = response["choices"][0]
print("temperature: 0.2, max_tokens: 5")
print("finish_reason:", choice["finish_reason"])
print("content:", choice["message"]["content"])
```

**실습 과제** Request JSON 탭에서 `"temperature": 0.2` 와 `"max_tokens": 5` 를 확인하고, `max_tokens` 를 50으로 올려 다시 실행해 보세요.

**완료 조건** `finish_reason: length` 가 출력되고, `main.py` 에 `temperature=0.2` 와 `max_tokens=5` 가 있으면 완료입니다. (50으로 바꾸면 이 미션은 다시 통과하지 않을 수 있으니, 확인 후 5로 되돌리세요.)

## 7. SSE 기반 스트리밍

일반 응답은 답이 완성될 때까지 기다립니다. 스트리밍은 답을 조각조각 받아 화면에 바로 보여 줍니다. OpenAI 호환 서버는 보통 **SSE(Server-Sent Events)** 형식으로 보냅니다.

```text
data: {"choices":[{"delta":{"content":"안녕"}}]}

data: {"choices":[{"delta":{"content":"하세요"}}]}

data: [DONE]
```

- `data:` 뒤의 JSON 한 줄이 하나의 chunk입니다.
- `choices[0].delta.content` 에 새 조각이 들어 있습니다.
- `data: [DONE]` 이 끝 신호입니다.

`stream_chat()` 은 조각을 모아 `choices[0].message.content` 를 완성하고, 수업용으로 `chunks` 목록도 함께 돌려줍니다.

**끊김 방지 규칙.** `stream_chat()` 은 UTF-8 조각이 한글 중간에서 갈라져도 이어 붙이는 증분 디코더를 씁니다. 줄바꿈이 `\r\n` 두 조각으로 나뉘어도, `: keep-alive` 주석이나 빈 줄이 섞여도 무시합니다. 마지막에 `[DONE]` 또는 `finish_reason` 을 못 받은 채 연결이 닫히면 **성공으로 치지 않고** "스트림이 끊겼습니다" 오류를 냅니다. Stop·시간 초과 때는 `AbortController` 로 실제 연결을 닫습니다.

**스트리밍 vs 비스트리밍 비교 실습**

같은 질문을 두 방식으로 보내고 화면을 비교해 보세요.

1. `await chat(default_messages())` 을 실행하고 결과가 **한 번에** 나타나는 것을 봅니다.
2. `await stream_chat(default_messages())` 을 실행하고 Assistant 탭이 **조각마다** 자라는 것을 봅니다.
3. Streaming 탭에서 **첫 조각까지 걸린 시간(TTFT)**, 조각 수, 전체 시간을 읽습니다.
4. 두 응답의 최종 문장은 같지만, 사용자가 결과를 보기 시작하는 시점이 다르다는 점을 정리합니다.


### Mission 7 — SSE 스트리밍 처리

**개념** `stream=True` 요청과 delta 누적을 연습합니다.

**예제 코드** (`main.py`)

```python
from llm_client import default_messages, stream_chat

response = await stream_chat(default_messages(), temperature=0.3, max_tokens=120)
chunks = response["chunks"]
content = response["choices"][0]["message"]["content"]
print("stream chunks:", len(chunks))
print("assistant:", content)
```

**실습 과제** Streaming 탭에서 조각을, Assistant 탭에서 완성된 문장을 비교하세요. `parse_sse_line("[DONE]")` 이 무엇을 돌려주는지도 생각해 보세요.

**완료 조건** `stream chunks:` 와 `assistant:` 가 출력되고, `main.py` 가 `stream_chat(` 을 호출하면 완료입니다.

## 8. 자유 실습 — 간단한 챗봇

이제 배운 것을 한 파일에 모읍니다. `chatbot.py` 에는 TODO만 있습니다. system 역할을 정하고, 답을 `messages` 에 쌓으면서 세 번 대화합니다.

**예제 코드** (`chatbot.py` 완성 예시)

```python
from llm_client import stream_chat

messages = [
    {"role": "system", "content": "너는 초등학생에게 설명하는 선생님이야."},
    {"role": "user", "content": "안녕! 너는 누구야?"},
]

first = await stream_chat(messages)
messages.append(first["choices"][0]["message"])
messages.append({"role": "user", "content": "방금 뭐라고 했어?"})

second = await stream_chat(messages)
messages.append(second["choices"][0]["message"])
messages.append({"role": "user", "content": "고마워!"})

third = await stream_chat(messages)
print("[chatbot]", third["choices"][0]["message"]["content"])
```

**실습 과제** `chatbot.py` 를 완성하고 터미널에 `python chatbot.py` 를 입력해 실행하세요. 파일 탭에서 `chatbot.py` 를 연 뒤 실행 버튼을 눌러도 됩니다.

**완료 조건** `chatbot.py` 에 `"system"` 과 `stream_chat(` 이 있고, 3번의 요청이 이전 assistant 답을 이어 쓰며, 출력에 `[chatbot]` 이 있으면 완료입니다.

## 실제 제공자에 연결하려면

1. 패널에서 **Live Mode** 를 누릅니다.
2. 제공자의 Base URL(예: `https://api.example.com/v1`)과 Model ID를 입력합니다.
3. 필요한 경우 API Key를 입력합니다. 키는 메모리에만 있습니다.
4. 실행합니다.

**CORS**: 브라우저는 스크립트가 다른 출처(origin)로 요청할 때 서버의 허용을 확인합니다. JSON 본문과 `Authorization` 헤더를 쓰는 POST는 먼저 `OPTIONS` **사전 요청(preflight)** 을 보내므로, 제공자가 `Access-Control-Allow-Origin` 뿐 아니라 `Access-Control-Allow-Headers: Authorization, Content-Type` 도 허용해야 합니다. Live Mode에서 `TypeError: Failed to fetch` 나 "CORS" 안내가 나면 제공자의 브라우저 직접 호출 허용 여부를 확인하세요. 허용하지 않는 제공자는 그대로는 연결할 수 없습니다. 이때는 백엔드 프록시가 필요하며, 이 강의에는 백엔드가 없습니다. (CORS는 브라우저 규칙이므로 CPython·명령줄 실습에서는 재현되지 않습니다.)

**시간 제한**: 이 강의의 Python 실행은 60초까지 허용됩니다. `chat()` 의 요청은 45초, `stream_chat()` 의 스트림은 40초에서 스스로 멈추고 원인을 알려 줍니다. 그래도 멈추지 않으면 **중단** 버튼을 누르세요. 중단은 worker를 종료하므로 다음 실행은 새 Python 환경에서 시작합니다.

**보안**: 실제 서비스에서는 API Key를 브라우저 코드에 넣지 말고 서버에서 보관해야 합니다. 이 강의의 Live Mode는 학습용이며, 키는 저장되지 않지만 브라우저 메모리와 실행 중인 Python 환경에는 존재합니다. **학습자가 Python 코드를 고쳐 키를 읽거나 출력할 수 있다는 점**을 항상 기억하세요. Mock Mode는 키를 Python으로 넘기지 않으므로 이 위험이 없습니다. 모델에게 키를 출력하라고 시키는 식의 유출도 조심하세요.

## 막혔을 때

- `SyntaxError` 가 나면 `await` 를 빼먹지 않았는지 확인하세요. `chat()` 과 `stream_chat()` 은 `async` 함수입니다.
- `KeyError: 'choices'` 가 나면 Response JSON 탭에서 실제 응답을 확인하세요. 오류 응답에는 `choices` 대신 `error` 가 있습니다.
- `finish_reason` 이 `length` 면 `max_tokens` 를 늘리세요.
- `Live Mode 에는 Base URL 이 필요합니다` 가 나오면 패널의 Base URL을 채우세요.
- Mock 응답이 이상해 보여도 정상입니다. Mock은 정해진 규칙으로 만든 수업용 응답입니다.
- 오른쪽 힌트 버튼에는 각 미션의 방향과 예제 위치가 적혀 있습니다.

## 다음 단계

- system 프롬프트를 바꿔 같은 질문에 답이 어떻게 달라지는지 비교해 보세요.
- `chatbot.py` 에 “요약해 줘”, “표로 정리해 줘” 같은 두 번째 역할을 넣어 보세요.
- 토큰 사용량을 보고 `max_tokens` 를 조절하는 습관을 들이세요.
- 실제 서비스로 만들 때는 키를 서버로 옮기고, 브라우저에는 서버 API만 노출하세요.
