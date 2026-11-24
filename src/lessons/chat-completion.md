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
    Live Mode 는 브라우저의 fetch 로 Base URL 에 실제 요청을 보냅니다.

    Base URL, API Key, Model ID, 프롬프트는 IDE 오른쪽 Chat Completion 패널에서
    입력하고, 실행할 때 환경 변수로 이 파일에 전달됩니다. 그래서 API Key 를
    소스코드나 저장 세션에 적을 필요가 없습니다.

    이 파일은 강의를 위해 준비된 파일입니다. 고치지 않아도 됩니다.
    """

    import json
    import os
    import time


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


    def mask_key(key=None):
        """키를 화면에 보여 줄 때 쓰는 가림 처리입니다."""
        value = API_KEY if key is None else key
        if not value:
            return "(비어 있음)"
        if len(value) <= 8:
            return "•" * len(value)
        return value[:4] + "••••" + value[-4:]


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


    def build_request(messages, *, temperature=None, max_tokens=None, stream=False):
        """HTTP 요청의 주소·헤더·본문을 dict 로 만듭니다."""
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
        return {"method": "POST", "url": endpoint(), "headers": headers, "body": body}


    def estimate_tokens(text):
        """정확한 토크나이저가 아닙니다. 글자 수로 어림합니다."""
        return max(1, (len(text) + 3) // 4)


    def _trace(kind, data):
        """오른쪽 패널이 읽는 기록. 실행이 끝나면 함께 지워집니다."""
        path = os.environ.get("CP_TRACE_PATH")
        if not path:
            return
        try:
            with open(path, "a", encoding="utf-8") as handle:
                handle.write(json.dumps({"kind": kind, "data": data}, ensure_ascii=False) + "\n")
        except OSError:
            pass


    def _safe_request(request):
        """기록에 남기기 전에 Authorization 헤더를 가립니다."""
        safe = json.loads(json.dumps(request))
        auth = safe["headers"].get("Authorization")
        if auth:
            safe["headers"]["Authorization"] = "Bearer " + mask_key()
        return safe


    def _mock_content(messages, max_tokens):
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
            if len(words) > max_tokens:
                content = " ".join(words[:max_tokens]) + " …"
                finish_reason = "length"
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


    async def _post_json(request):
        from pyodide.http import pyfetch

        response = await pyfetch(
            request["url"],
            method=request["method"],
            headers=request["headers"],
            body=json.dumps(request["body"]),
        )
        text = await response.string()
        return response.status, text


    def _network_error(error):
        return (
            "네트워크 요청이 실패했습니다. 브라우저에서 직접 호출하므로 "
            "제공자가 CORS 를 허용해야 합니다. Base URL 과 HTTPS 주소를 확인하세요. "
            f"({type(error).__name__}: {error})"
        )


    async def chat(messages, *, temperature=1.0, max_tokens=None):
        """messages 를 보내고 chat.completion 응답 dict 를 돌려줍니다."""
        request = build_request(
            messages, temperature=temperature, max_tokens=max_tokens
        )
        _trace("request", _safe_request(request))

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
            raise RuntimeError(
                f"요청이 {REQUEST_TIMEOUT}초 안에 끝나지 않았습니다. "
                "네트워크와 Base URL 을 확인하세요."
            ) from None
        except Exception as error:
            raise RuntimeError(_network_error(error)) from error

        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            _trace("error", {"status": status, "message": "JSON 이 아닌 응답"})
            raise RuntimeError(
                f"JSON 이 아닌 응답을 받았습니다 (HTTP {status}). Base URL 을 확인하세요."
            ) from None

        if status >= 400 or (isinstance(data, dict) and "error" in data):
            error = data.get("error") if isinstance(data, dict) else None
            message = (
                error.get("message")
                if isinstance(error, dict)
                else str(data)[:200]
            )
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
        """data: 한 줄을 dict 로, [DONE] 은 문자열 'DONE' 으로 바꿉니다."""
        line = line.strip()
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


    async def _mock_stream(messages, max_tokens):
        response = _mock_response(messages, max_tokens)
        content = response["choices"][0]["message"]["content"]
        words = content.split(" ")
        chunks = []
        import asyncio

        for index, word in enumerate(words):
            piece = word + (" " if index < len(words) - 1 else "")
            chunk = {"choices": [{"index": 0, "delta": {"content": piece}}]}
            chunks.append(chunk)
            _trace("chunk", chunk)
            await asyncio.sleep(0.01)

        response["chunks"] = chunks
        _trace("response", {key: value for key, value in response.items() if key != "chunks"})
        _trace("usage", response["usage"])
        return response


    async def _live_stream(request):
        import codecs
        from js import JSON as JsJSON
        from js import fetch

        init = JsJSON.parse(
            json.dumps(
                {
                    "method": "POST",
                    "headers": request["headers"],
                    "body": json.dumps(request["body"]),
                }
            )
        )
        try:
            response = await fetch(request["url"], init)
        except Exception as error:
            raise RuntimeError(_network_error(error)) from error

        if not response.ok:
            text = await response.text()
            _trace("error", {"status": response.status, "message": text[:300]})
            raise RuntimeError(f"HTTP {response.status}: {text[:300]}")

        reader = response.body.getReader()
        decoder = codecs.getincrementaldecoder("utf-8")()
        buffer = ""
        content = ""
        chunks = []
        usage = None
        finish_reason = None
        done_marker = False
        deadline = time.monotonic() + STREAM_TIMEOUT

        while not done_marker:
            if time.monotonic() > deadline:
                raise RuntimeError(
                    f"스트리밍이 {STREAM_TIMEOUT}초 안에 끝나지 않았습니다. "
                    "Stop 을 누르거나 Base URL 을 확인하세요."
                )
            result = await reader.read()
            if result.done:
                break
            buffer += _decode_chunk(result.value, decoder)
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                event = parse_sse_line(line)
                if event is None:
                    continue
                if event == "DONE":
                    done_marker = True
                    break
                chunks.append(event)
                choice = _first_choice(event)
                delta = choice.get("delta") if isinstance(choice, dict) else None
                piece = delta.get("content") if isinstance(delta, dict) else None
                if piece:
                    content += piece
                if isinstance(choice, dict) and choice.get("finish_reason"):
                    finish_reason = choice["finish_reason"]
                if event.get("usage"):
                    usage = event["usage"]
                _trace("chunk", event)

        data = {
            "id": "chatcmpl-live-stream",
            "object": "chat.completion",
            "model": MODEL,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": finish_reason or "stop",
                }
            ],
            "chunks": chunks,
        }
        if usage:
            data["usage"] = usage
            _trace("usage", usage)
        _trace("response", {key: value for key, value in data.items() if key != "chunks"})
        return data


    async def stream_chat(messages, *, temperature=1.0, max_tokens=None):
        """SSE 조각을 모아 하나의 assistant 응답으로 돌려줍니다."""
        request = build_request(
            messages, temperature=temperature, max_tokens=max_tokens, stream=True
        )
        _trace("request", _safe_request(request))
        if MODE == "mock":
            return await _mock_stream(messages, max_tokens)
        _require_live_settings()
        return await _live_stream(request)
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
      본문 Mission 2 의 예제를 main.py 에 그대로 옮겨 실행하세요. build_request(default_messages(), temperature=0.7, max_tokens=200) 의 결과에서 headers 의 Authorization 은 가려지고, body 에 model·messages·temperature·max_tokens 가 들어갑니다. 오른쪽 Request JSON 탭에서도 같은 모양을 볼 수 있습니다.
    check:
      - type: stdout-contains
        value: '"messages"'
      - type: stdout-contains
        value: '"temperature": 0.7'
      - type: file-matches
        path: main.py
        value: 'build_request\s*\('
  - id: chat-first-call
    title:
      ko: 첫 Chat Completion 호출
      en: Make the first call
    goal: |
      await chat(default_messages()) 로 첫 요청을 보내고 assistant 메시지를 출력하세요.
    hint: |
      본문 Mission 3 의 예제처럼 main.py 를 바꾸고 실행하세요. chat() 은 async 함수라 await 가 필요합니다. 응답 본문은 response["choices"][0]["message"]["content"] 에 있습니다. 실행이 끝나면 Assistant 탭과 Response JSON 탭에 결과가 모입니다.
    check:
      - type: stdout-matches
        value: 'assistant: .+'
      - type: file-matches
        path: main.py
        value: 'await\s+chat\('
  - id: chat-response
    title:
      ko: 응답 JSON 파싱
      en: Parse the response
    goal: |
      choices[0] 에서 role·finish_reason·content 를 꺼내고 usage 의 토큰 수를 읽으세요.
    hint: |
      본문 Mission 4 의 예제를 사용하세요. choice = response["choices"][0] 으로 첫 후보를 고른 뒤 choice["message"]["role"], choice["finish_reason"], choice["message"]["content"] 를 출력합니다. usage 전체를 출력하면 total_tokens 도 함께 보입니다. Mock Mode 는 짧은 답이라 finish_reason 이 stop 입니다.
    check:
      - type: stdout-contains
        value: 'role: assistant'
      - type: stdout-contains
        value: 'finish_reason: stop'
      - type: stdout-contains
        value: 'total_tokens'
  - id: chat-roles
    title:
      ko: 역할과 멀티턴 대화
      en: Roles and multi-turn chat
    goal: |
      system 으로 역할을 정하고, 첫 assistant 답을 messages 에 append 해 두 번째 질문을 이어 가세요.
    hint: |
      본문 Mission 5 의 예제를 사용하세요. messages 에 system·user 를 넣고 첫 호출을 합니다. 그다음 first["choices"][0]["message"] 를 messages 에 append 하고 새 user 메시지를 붙여 다시 호출합니다. API 는 이전 대화를 기억하지 않으므로 매번 전체 messages 를 보내야 합니다. Mock Mode 는 두 번째 호출에 [2번째 턴] 표시를 붙입니다.
    check:
      - type: stdout-contains
        value: '2번째 턴'
      - type: file-matches
        path: main.py
        value: 'append\s*\('
      - type: file-matches
        path: main.py
        value: '"system"'
  - id: chat-parameters
    title:
      ko: temperature와 max_tokens
      en: Control temperature and max_tokens
    goal: |
      temperature 를 0.2 로, max_tokens 를 5 로 보내고 finish_reason 이 length 로 바뀌는지 확인하세요.
    hint: |
      본문 Mission 6 의 예제를 사용하세요. chat(messages, temperature=0.2, max_tokens=5) 처럼 두 값을 직접 넘깁니다. 요청 JSON 에 두 값이 들어가고, 답이 5단어를 넘으면 Mock Mode 가 자르면서 finish_reason 을 length 로 바꿉니다. 실제 API 에서도 max_tokens 에 닿으면 length 가 됩니다.
    check:
      - type: stdout-contains
        value: 'finish_reason: length'
      - type: file-matches
        path: main.py
        value: 'temperature\s*=\s*0\.2'
      - type: file-matches
        path: main.py
        value: 'max_tokens\s*=\s*5'
  - id: chat-stream
    title:
      ko: SSE 스트리밍 처리
      en: Handle an SSE stream
    goal: |
      stream_chat 으로 조각을 모아 assistant 메시지를 만들고, Streaming 탭에서 조각을 확인하세요.
    hint: |
      본문 Mission 7 의 예제를 사용하세요. stream_chat 은 stream=True 요청을 보내고 data: 줄을 하나씩 읽어 delta.content 를 이어 붙입니다. 돌려주는 dict 에는 완성된 choices[0].message.content 와 수업용 chunks 목록이 함께 있습니다. Streaming 탭에는 조각이, Response JSON 탭에는 완성된 응답이 보입니다.
    check:
      - type: stdout-contains
        value: 'stream chunks:'
      - type: stdout-matches
        value: 'assistant: .+'
      - type: file-matches
        path: main.py
        value: 'stream_chat\s*\('
  - id: chat-chatbot
    title:
      ko: 자유 실습 — 챗봇
      en: Free practice — a chatbot
    goal: |
      chatbot.py 의 TODO 를 채워 system 역할을 가진 3턴 대화를 완성하고, [chatbot] 으로 시작하는 결과를 출력하세요.
    hint: |
      본문 Mission 8 의 완성 예시를 chatbot.py 에 옮기세요. system 메시지로 역할을 정하고, stream_chat 으로 첫 답을 받은 뒤 그 assistant 메시지와 새 user 메시지를 messages 에 append 하는 일을 세 번 반복합니다. 마지막 답을 print("[chatbot]", ...) 로 출력하고, 터미널에 python chatbot.py 를 입력하거나 파일을 연 뒤 실행하세요.
    check:
      - type: file-matches
        path: chatbot.py
        value: 'stream_chat\s*\('
      - type: file-matches
        path: chatbot.py
        value: '"system"'
      - type: stdout-contains
        value: '[chatbot]'
      - type: stdout-contains
        value: '3번째 턴'
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

**API Key는 메모리에서만 관리합니다.** 패널에 입력한 키는 실행할 때 Python으로 전달되고, 실행이 끝나면 지워집니다. 저장 세션, 소스코드, 요청 기록에는 남지 않으며 Request JSON의 Authorization 헤더는 마스킹됩니다.

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

**완료 조건** `role: assistant`, `finish_reason: stop`, `total_tokens` 가 출력되면 완료입니다.

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

**완료 조건** `chatbot.py` 에 `"system"` 과 `stream_chat(` 이 있고, 출력에 `[chatbot]` 과 `3번째 턴` 이 있으면 완료입니다.

## 실제 제공자에 연결하려면

1. 패널에서 **Live Mode** 를 누릅니다.
2. 제공자의 Base URL(예: `https://api.example.com/v1`)과 Model ID를 입력합니다.
3. 필요한 경우 API Key를 입력합니다. 키는 메모리에만 있습니다.
4. 실행합니다.

**CORS**: 브라우저는 다른 출처(origin)로 요청할 때 서버의 허용을 확인합니다. Live Mode에서 `TypeError: Failed to fetch` 나 네트워크 오류가 나면, 제공자가 브라우저 직접 호출(CORS)을 허용하는지 확인하세요. 허용하지 않는 제공자는 그대로는 연결할 수 없습니다. 이때는 백엔드 프록시가 필요하며, 이 강의에는 백엔드가 없습니다.

**시간 제한**: 이 강의의 Python 실행은 60초까지 허용됩니다. `chat()` 의 요청은 45초, `stream_chat()` 의 스트림은 40초에서 스스로 멈추고 원인을 알려 줍니다. 그래도 멈추지 않으면 **중단** 버튼을 누르세요. 중단은 worker를 종료하므로 다음 실행은 새 Python 환경에서 시작합니다.

**보안**: 실제 서비스에서는 API Key를 브라우저 코드에 넣지 말고 서버에서 보관해야 합니다. 이 강의의 Live Mode는 학습용이며, 키는 저장되지 않지만 브라우저 메모리에는 존재합니다. 모델에게 키를 출력하라고 시키는 식의 유출도 조심하세요.

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
