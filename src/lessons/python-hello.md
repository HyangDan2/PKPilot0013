---
id: python-hello
order: 1
title:
  ko: Python Hello World
  en: Python Hello World
subtitle:
  ko: 설치 없이 브라우저에서 첫 파이썬 코드를 실행합니다
  en: Run your first Python in the browser, with nothing to install
level:
  ko: 기초
  en: Beginner
runtime: python
panels: [output]
entry: main.py
files:
  main.py: |
    # CodePlayground · Python 기초
    # 실행: Ctrl+Enter 또는 오른쪽 위 실행 버튼

    name = "학습자"
    print(f"안녕하세요, {name}입니다.")
    print(2 + 3)
  practice.py: |
    # 자유롭게 연습하는 파일입니다.
    # 아래 리스트를 가지고 직접 계산해 보세요.

    numbers = [12, 45, 7, 23, 88, 34, 61, 15]
    print(numbers)
missions:
  - id: py-run
    title:
      ko: 첫 코드 실행
      en: Run your first program
    goal:
      ko: 실행 버튼이나 Ctrl+Enter 로 main.py 를 실행해 결과를 확인해 보세요.
      en: Run main.py with the Run button or Ctrl+Enter and read the output.
    hint:
      ko: 첫 실행에는 파이썬 런타임(Pyodide)을 내려받기 때문에 잠시 걸립니다. 진행률이 끝나면 오른쪽 '실행 결과' 카드에 출력이 나타납니다.
      en: The first run downloads the Pyodide runtime, so it takes a moment. When the progress bar finishes, the output card on the right fills in.
    check:
      type: ran
  - id: py-name
    title:
      ko: 변수로 나를 소개하기
      en: Introduce yourself with a variable
    goal:
      ko: name 값을 CodePlayground로 바꾸고 f-문자열로 인사 문장을 출력해 보세요.
      en: Set name to CodePlayground and print a greeting with an f-string.
    hint:
      ko: main.py 의 name = "학습자" 를 name = "CodePlayground"로 고친 뒤 실행하세요. 출력은 "안녕하세요, CodePlayground입니다." 가 되어야 합니다.
      en: Change name = "학습자" to name = "CodePlayground" and run again. The output should read "안녕하세요, CodePlayground입니다.".
    check:
      - type: stdout-contains
        value: '안녕하세요, CodePlayground'
      - type: file-contains
        value: 'name = "CodePlayground"'
  - id: py-loop
    title:
      ko: 반복문으로 1부터 5까지
      en: Loop from 1 to 5
    goal:
      ko: for 문으로 1부터 5까지 한 줄에 하나씩 출력해 보세요.
      en: Print 1 through 5, one number per line, with a for loop.
    hint:
      ko: for i in range(1, 6): 아래에 네 칸 들여쓰기로 print(i) 를 넣고 실행하세요. 들여쓰기가 어긋나면 IndentationError 가 납니다.
      en: Under for i in range(1, 6): add an indented print(i) and run. Wrong indentation raises IndentationError.
    check:
      - type: stdout-lines
        values: ['1', '2', '3', '4', '5']
      - type: file-matches
        value: 'for\s+\w+\s+in\s+range'
  - id: py-sum
    title:
      ko: 리스트 합계 구하기
      en: Sum a list
    goal:
      ko: numbers 리스트의 합계 285 를 sum() 으로 계산해 출력해 보세요.
      en: Use sum() to print the total of the numbers list — 285.
    hint:
      ko: total = sum(numbers) 를 만든 뒤 print(f"합계: {total}") 를 실행하세요. practice.py 에 적어도 됩니다.
      en: Write total = sum(numbers), then print(f"합계: {total}"). practice.py works too.
    check:
      - type: stdout-contains
        value: '285'
      - type: file-matches
        value: 'sum\s*\('
---

## 이 강의에서 배우는 것

파이썬은 읽기 쉬운 문법 덕분에 처음 배우기에 가장 좋은 언어입니다.
이 강의에서는 **설치 없이** 브라우저에서 진짜 CPython을 실행하며 다음 네 가지를 익힙니다.

- `print()` 로 화면에 출력하기
- 변수와 **f-문자열**로 문장 만들기
- `for` 반복문으로 같은 일 되풀이하기
- 리스트와 `sum()` 으로 값 모으기

왼쪽 위 **파일** 탭에서 실습 파일을 고르고, 가운데 에디터에서 코드를 고친 뒤
`Ctrl + Enter`(맥은 `⌘ + Enter`)로 실행합니다.

## 1. 첫 실행

`main.py` 에는 이미 세 줄의 코드가 들어 있습니다.

```python
name = "학습자"
print(f"안녕하세요, {name}입니다.")
print(2 + 3)
```

에디터 위의 **실행** 버튼을 누르면 오른쪽 **실행 결과** 카드에 다음이 표시됩니다.

```text
안녕하세요, 학습자입니다.
5
```

> 처음 실행할 때만 파이썬 런타임(약 10MB)을 내려받습니다. 두 번째부터는 곧바로 실행됩니다.

## 2. 변수와 f-문자열

변수는 값을 담아 두는 이름표입니다. `=` 는 "같다"가 아니라 **오른쪽 값을 왼쪽 이름에 넣는다**는 뜻입니다.

| 문법 | 예 | 결과 |
| --- | --- | --- |
| 문자열 | `"안녕"` | 안녕 |
| 숫자 | `42`, `3.14` | 42, 3.14 |
| f-문자열 | `f"{name}님"` | 변수 값이 문장 안에 들어갑니다 |
| 계산 | `2 + 3`, `10 / 4` | 5, 2.5 |

`print("안녕하세요, " + name + "입니다.")` 처럼 더하기로 이어 붙일 수도 있지만,
f-문자열이 훨씬 읽기 쉽습니다.

## 3. 반복문

같은 일을 여러 번 할 때는 `for` 문을 씁니다. **들여쓰기 네 칸**이 반복할 몸통을 표시합니다.

```python
for i in range(1, 6):
    print(i)
```

`range(1, 6)` 은 1부터 5까지입니다. 끝 숫자 6은 포함되지 않는다는 점을 기억하세요.

## 4. 리스트와 합계

리스트는 값을 순서대로 담는 상자입니다.

```python
numbers = [12, 45, 7, 23, 88, 34, 61, 15]
print(len(numbers))   # 8  — 값의 개수
print(sum(numbers))   # 285 — 합계
print(max(numbers))   # 88 — 가장 큰 값
```

평균은 `sum(numbers) / len(numbers)` 로 구합니다.

## 자주 쓰는 내장 함수

| 함수 | 하는 일 | 예 |
| --- | --- | --- |
| `print(x)` | 값을 출력합니다 | `print("hi")` |
| `len(x)` | 길이를 셉니다 | `len("abc")` → 3 |
| `sum(x)` | 리스트 합계 | `sum([1, 2, 3])` → 6 |
| `max(x)` / `min(x)` | 최댓값 / 최솟값 | `max([4, 9])` → 9 |
| `range(a, b)` | a부터 b-1까지 | `range(1, 4)` → 1, 2, 3 |

## 막혔을 때

- 오류 메시지는 **마지막 줄**부터 읽습니다. `SyntaxError` 는 문법, `IndentationError` 는 들여쓰기 문제입니다.
- 실행 결과가 비어 있으면 `print()` 를 빠뜨리지 않았는지 확인해 보세요.
- 값을 확인하고 싶으면 코드 중간에 `print(값)` 을 넣어 보는 것이 가장 빠릅니다.

네 미션을 모두 끝내면 **자유 실습**으로 넘어가 `practice.py` 에서 마음껏 실험해 보세요.
