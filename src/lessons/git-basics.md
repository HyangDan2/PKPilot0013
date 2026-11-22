---
id: git-basics
order: 2
title:
  ko: Git 기초
  en: Git Basics
subtitle:
  ko: 커밋·브랜치·병합을 실제 터미널 명령으로 익힙니다
  en: Commit, branch and merge with real terminal commands
level:
  ko: 기초
  en: Beginner
runtime: git
panels: [git-graph, working-tree]
entry: README.md
files:
  README.md: |
    # CodePlayground · Git 기초 실습 저장소

    이 폴더는 Git 을 손으로 익히는 공간입니다.
    아래 순서대로 진행해 보세요.

    1. git init
    2. git add . && git commit -m "첫 커밋"
    3. git switch -c feature
    4. git merge feature
  hello.txt: |
    안녕하세요, Git!
    이 파일은 첫 커밋에 함께 담깁니다.
  notes.md: |
    # 학습 메모

    - git status 는 작업 트리 상태를 보여 줍니다.
    - git add 는 변경을 스테이징합니다.
    - git commit 은 스테이징된 변경을 기록합니다.
missions:
  - id: git-init
    title:
      ko: 저장소 초기화
      en: Initialise the repository
    goal:
      ko: 터미널에 git init 을 입력해 이 폴더를 Git 저장소로 만들어 보세요.
      en: Type git init in the terminal to turn this folder into a Git repository.
    hint:
      ko: 터미널에 git init 을 입력하고 Enter 를 누르세요. 오른쪽 작업 트리 카드에 브랜치 main 과 추적되지 않은 파일들이 나타납니다.
      en: Type git init and press Enter. The working tree card on the right shows branch main and the untracked files.
    check:
      type: git-init
  - id: git-first-commit
    title:
      ko: 첫 커밋 만들기
      en: Make the first commit
    goal:
      ko: 파일을 하나 고친 뒤 git add . 와 git commit -m "메시지" 로 첫 커밋을 남겨 보세요.
      en: Edit a file, then stage and record it with git add . and git commit -m "message".
    hint:
      ko: hello.txt 를 한 줄 고치고 git add . 다음 git commit -m "첫 커밋" 을 실행하세요. 커밋 그래프에 첫 점이 생기고 작업 트리가 깨끗해집니다.
      en: Change hello.txt, run git add ., then git commit -m "first commit". A first dot appears in the commit graph and the working tree becomes clean.
    check:
      type: git-commits
      min: 1
  - id: git-branch
    title:
      ko: 브랜치 만들고 이동하기
      en: Create and switch a branch
    goal:
      ko: git switch -c feature 로 새 브랜치를 만들고 그 위에서 커밋을 하나 남겨 보세요.
      en: Create a branch with git switch -c feature and leave one commit on it.
    hint:
      ko: git switch -c feature 는 브랜치를 만들고 곧바로 이동합니다. 파일을 고치고 git add ., git commit -m "기능 추가" 를 실행하세요. 그래프에 feature 가지가 갈라집니다.
      en: git switch -c feature creates and moves in one step. Edit a file, then git add . and git commit -m "add feature". The graph forks a feature lane.
    check:
      type: git-branch
      name: feature
  - id: git-merge
    title:
      ko: 두 브랜치 병합하기
      en: Merge two branches
    goal:
      ko: main 에도 커밋을 하나 남긴 뒤 git merge 로 feature 브랜치를 병합해 보세요.
      en: Add a commit on main as well, then bring feature in with git merge.
    hint:
      ko: git switch main → 파일 수정 → git add . → git commit -m "main 작업" → git merge feature 순서로 실행하세요. 양쪽에 커밋이 있으면 병합 커밋이 만들어집니다.
      en: Run git switch main → edit a file → git add . → git commit -m "main work" → git merge feature. With commits on both sides you get a merge commit.
    check:
      type: git-merge
---

## 이 강의에서 배우는 것

Git 은 파일의 **변경 이력**을 남기는 도구입니다. 코드를 지우거나 잘못 고쳐도
이전 상태로 돌아갈 수 있고, 여러 사람이 같은 프로젝트에서 각자의 작업을 합칠 수 있습니다.

이 강의에서는 실제 터미널에 명령을 입력하며 다음을 익힙니다.

- 저장소를 만드는 `git init`
- 변경을 골라 담는 `git add` 와 기록하는 `git commit`
- 갈라져 나가는 `branch`, 옮겨 가는 `switch`, 합치는 `merge`

오른쪽의 **커밋 그래프**와 **작업 트리** 카드를 보면서 명령이 상태를 어떻게 바꾸는지
바로 확인해 보세요.

## 1. 저장소 만들기

```bash
git init
```

폴더에 `.git` 이라는 기록 공간이 생기고, 기본 브랜치 `main` 이 만들어집니다.
이때 오른쪽 작업 트리 카드에는 아직 추적되지 않은(`?`) 파일 세 개가 보입니다.

## 2. 스테이징과 커밋

커밋은 **두 단계**입니다. 먼저 담을 변경을 고르고(`add`), 그다음 기록합니다(`commit`).

```bash
git status
git add .
git commit -m "첫 커밋"
```

| 명령 | 하는 일 |
| --- | --- |
| `git status` | 어떤 파일이 바뀌었는지 보여 줍니다 |
| `git add <파일>` | 그 파일의 변경을 스테이징합니다 |
| `git add .` | 현재 폴더의 모든 변경을 스테이징합니다 |
| `git commit -m "메시지"` | 스테이징된 변경을 하나의 이력으로 기록합니다 |
| `git log --oneline` | 커밋 목록을 한 줄씩 보여 줍니다 |

> 커밋 메시지는 "무엇을 했는지"를 짧게 적습니다. `첫 커밋`, `로그인 화면 추가` 처럼요.

## 3. 브랜치로 갈라지기

브랜치는 원래 줄기에서 갈라져 나온 **나만의 작업선**입니다.

```bash
git switch -c feature
```

`-c` 는 "새로 만들면서 이동"이라는 뜻입니다. 이제 `feature` 브랜치에서 커밋을 남겨도
`main` 은 그대로입니다. 커밋 그래프에서 두 줄기가 갈라지는 것을 볼 수 있습니다.

```bash
git switch main     # 원래 줄기로 돌아가기
git branch          # 브랜치 목록 보기
```

## 4. 병합하기

`main` 과 `feature` 양쪽에 커밋이 있다면 병합할 때 **병합 커밋**이 하나 생깁니다.

```bash
git switch main
# 파일을 고치고
git add .
git commit -m "main 작업"
git merge feature
```

병합 결과는 커밋 그래프에서 두 줄기가 하나로 합쳐지는 모양으로 나타납니다.

## 자주 쓰는 명령 한눈에 보기

| 상황 | 명령 |
| --- | --- |
| 지금 상태 확인 | `git status` |
| 변경 내용 비교 | `git diff` |
| 최근 이력 보기 | `git log --oneline` |
| 새 브랜치 만들며 이동 | `git switch -c <이름>` |
| 다른 브랜치로 이동 | `git switch <이름>` |
| 다른 브랜치 합치기 | `git merge <이름>` |
| 마지막 커밋으로 되돌리기 | `git reset --hard HEAD` |

## 막혔을 때

- `fatal: not a git repository` — 아직 `git init` 을 하지 않았습니다.
- `nothing to commit` — 변경이 없거나 `git add` 를 잊었습니다.
- `CONFLICT` — 같은 줄을 양쪽에서 고쳤습니다. `<<<<<<<`, `=======`, `>>>>>>>` 표시를 지우고 원하는 내용만 남긴 뒤 `git add .`, `git commit -m "merge"` 를 실행하세요.
- 실습을 처음부터 다시 하려면 오른쪽 위 `⋮` 메뉴에서 **강의 파일 초기화**를 고르세요.

네 미션을 모두 마치면 **자유 실습**에서 rebase 나 reset 같은 명령도 시험해 보세요.
