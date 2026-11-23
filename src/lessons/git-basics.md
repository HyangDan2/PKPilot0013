---
id: git-basics
order: 2
title:
  ko: Git 기초
  en: Git Basics
subtitle:
  ko: 커밋·브랜치·병합·원격 push까지 실제 터미널 명령으로 익힙니다
  en: Commit, branch, merge and push with real terminal commands
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
    아래 순서대로 명령을 그대로 입력해 보세요. 오른쪽 카드가 단계마다 바뀝니다.

    1. git init
    2. git add . && git commit -m "첫 커밋"
    3. git switch -c feature
    4. notes.md 끝에 한 줄 추가 → git add . && git commit -m "메모 추가"
    5. git switch main → README.md 끝에 한 줄 추가 → git add . && git commit -m "README 정리"
    6. git merge feature
    7. git remote add origin https://github.com/learner/playground.git
    8. git push -u origin main

    명령은 항상 지금 서 있는 브랜치에 적용됩니다.
    6번(git merge feature)은 반드시 main 에서 실행하세요.
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
      ko: hello.txt 끝에 한 줄을 적고 git add . 다음 git commit -m "첫 커밋" 을 실행하세요. 커밋 그래프에 첫 점이 생기고 작업 트리가 깨끗해집니다.
      en: Add a line to hello.txt, run git add ., then git commit -m "first commit". A first dot appears in the commit graph and the working tree becomes clean.
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
      ko: git switch -c feature 로 이동한 뒤 notes.md 끝에 "- feature 브랜치에서 적은 메모" 를 추가하고 git add . , git commit -m "메모 추가" 를 실행하세요. 그래프에 feature 가지가 갈라집니다.
      en: Run git switch -c feature, add a line such as "- a note from the feature branch" to notes.md, then git add . and git commit -m "add a note". The graph forks a feature lane.
    check:
      type: git-branch
      name: feature
  - id: git-merge
    title:
      ko: 두 브랜치 병합하기
      en: Merge two branches
    goal:
      ko: main 으로 돌아가 커밋을 하나 남긴 뒤 git merge feature 로 feature 브랜치를 병합해 보세요.
      en: Go back to main, add a commit there, then bring feature in with git merge feature.
    hint:
      ko: git switch main → README.md 마지막 줄에 한 줄 추가 → git add . → git commit -m "README 정리" → git merge feature 순서입니다. feature 가 고친 notes.md 와 다른 파일(README.md)을 고쳐야 충돌 없이 병합 커밋이 만들어집니다. main 에 커밋이 없으면 fast-forward 로 합쳐지는데, 그 경우도 미션은 통과합니다.
      en: Run git switch main → add a line to the end of README.md → git add . → git commit -m "update the README" → git merge feature. Editing a different file from the one feature changed (notes.md) gives a clean merge commit; without a commit on main git simply fast-forwards, which also passes.
    check:
      type: git-merge
  - id: git-remote
    title:
      ko: 원격 저장소 연결하기
      en: Connect a remote
    goal:
      ko: git remote add origin <주소> 로 이 저장소에 원격(origin)을 등록해 보세요.
      en: Register a remote named origin with git remote add origin <url>.
    hint:
      ko: git remote add origin https://github.com/learner/playground.git 을 실행하고 git remote -v 로 확인하세요. 이 실습의 origin 은 페이지 안에서만 움직이는 가상 원격 저장소입니다.
      en: Run git remote add origin https://github.com/learner/playground.git and check it with git remote -v. In this sandbox origin is a virtual remote held inside the page.
    check:
      type: git-remote
      name: origin
  - id: git-push
    title:
      ko: 원격에 올리기
      en: Push to the remote
    goal:
      ko: git push -u origin main 으로 main 브랜치를 원격에 올리고 업스트림을 연결해 보세요.
      en: Run git push -u origin main to publish main and set its upstream.
    hint:
      ko: git push -u origin main 을 실행하면 "branch 'main' set up to track 'origin/main'." 과 "* [new branch] main -> main" 이 나옵니다. git status 에 "Your branch is up to date with 'origin/main'." 이 보이면 완료입니다. 이후에 커밋을 하나 더 만들면 "ahead of 'origin/main' by 1 commit" 이 되고, git push 만 다시 실행하면 올라갑니다.
      en: git push -u origin main prints "branch 'main' set up to track 'origin/main'." and "* [new branch] main -> main". When git status says "Your branch is up to date with 'origin/main'." the mission is done. Make one more commit afterwards to see "ahead of 'origin/main' by 1 commit", then plain git push sends it.
    check:
      type: git-push
      remote: origin
      branch: main
---

## 이 강의에서 배우는 것

Git 은 파일의 **변경 이력**을 남기는 도구입니다. 코드를 지우거나 잘못 고쳐도
이전 상태로 돌아갈 수 있고, 여러 사람이 같은 프로젝트에서 각자의 작업을 합칠 수 있습니다.

이 강의에서는 실제 터미널에 명령을 입력하며 다음을 익힙니다.

- 저장소를 만드는 `git init`
- 변경을 골라 담는 `git add` 와 기록하는 `git commit`
- 갈라져 나가는 `branch`, 옮겨 가는 `switch`, 합치는 `merge`
- 원격 저장소에 올리는 `remote` · `push`, 받아 오는 `fetch` · `pull`

오른쪽의 **커밋 그래프**와 **작업 트리** 카드를 보면서 명령이 상태를 어떻게 바꾸는지
바로 확인해 보세요. 원격을 연결하면 그래프에 `origin/main` 이 함께 표시됩니다.

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

병합은 **지금 서 있는 브랜치에 다른 브랜치를 합치는** 명령입니다.
그래서 순서가 중요합니다. 먼저 `main` 으로 돌아와, 그 위에 main 쪽 작업을 하나 남깁니다.

```bash
git switch main
# README.md 마지막 줄에 한 줄 추가
git add .
git commit -m "README 정리"
git merge feature
```

`feature` 는 `notes.md` 를, `main` 은 `README.md` 를 고쳤기 때문에 서로 부딪히지 않고
**병합 커밋**이 하나 생깁니다. 커밋 그래프에서 두 줄기가 하나로 합쳐지는 모양입니다.

### "Already up to date." 만 나올 때

`feature` 브랜치에 서 있는 채로 `git merge feature` 를 실행하면 **자기 자신을 합치려는**
것이라 아무 일도 일어나지 않고 `Already up to date.` 만 출력됩니다.
병합 전에 `git switch main` 으로 옮겼는지 확인하세요. 지금 어느 브랜치에 있는지는
`git status` 첫 줄이나 작업 트리 카드의 `main · …` 표시로 알 수 있습니다.

### fast-forward 와 병합 커밋

- `main` 이 갈라진 뒤 **그대로**였다면, git 은 병합 커밋을 만들지 않고 `main` 을 `feature`
  끝으로 옮깁니다. 이것이 **fast-forward**(빠른 감기)입니다. `Fast-forward` 라고 출력되고
  이력은 한 줄로 이어집니다. 이 경우도 "두 브랜치를 합쳤다"로 인정되어 미션이 통과합니다.
- 양쪽 모두에 커밋이 있으면 병합 커밋(`Merge made by the 'ort' strategy.`)이 생깁니다.

두 방식 모두 정상입니다. 차이는 "이력이 갈라졌다가 합쳐진 흔적을 남기느냐" 뿐입니다.
빠른 감기가 되어도 **항상 병합 커밋을 남기고 싶다면** `git merge --no-ff feature` 처럼
`--no-ff` 를 붙입니다.

## 5. 원격 저장소에 올리기

지금까지는 내 컴퓨터(브라우저) 안에서만 작업했습니다. 원격(remote)은 이 이력을
**바깥 저장소**에 올려 두는 곳입니다. GitHub 저장소가 대표적입니다.

```bash
git remote add origin https://github.com/learner/playground.git   # 이름과 주소 등록
git remote -v                                                     # 등록 확인
git push -u origin main                                           # main 을 올리고 업스트림 연결
```

성공하면 이렇게 나옵니다.

```
branch 'main' set up to track 'origin/main'.
To https://github.com/learner/playground.git
 * [new branch]      main -> main
```

`-u`(`--set-upstream`)는 "이 브랜치는 `origin/main` 을 따라간다"는 연결을 남깁니다.
한 번 연결해 두면 다음부터는 `git push`, `git pull` 만으로 동작합니다.

```bash
git status
# On branch main
# Your branch is up to date with 'origin/main'.
```

커밋을 하나 더 만들면 상태가 바뀝니다.

```
Your branch is ahead of 'origin/main' by 1 commit.
  (use "git push" to publish your local commits)
```

다시 `git push` 하면 올라가고, 올릴 것이 없으면 `Everything up-to-date` 라고 나옵니다.

### 받아오기 — fetch 와 pull

```bash
git fetch             # 원격의 최신 상태만 확인합니다 (내 브랜치는 그대로)
git pull              # fetch + 지금 브랜치에 합치기(merge)
git pull origin main  # 원격과 브랜치를 직접 지정
```

| 명령 | 하는 일 |
| --- | --- |
| `git remote -v` | 등록된 원격의 이름과 주소를 보여 줍니다 |
| `git push -u origin main` | main 을 올리고 업스트림을 연결합니다 |
| `git push` | 연결된 업스트림으로 올립니다 |
| `git fetch` | 원격 상태만 받아 옵니다 (작업 트리는 그대로) |
| `git pull` | 받아 온 뒤 지금 브랜치에 합칩니다 |

원격 트래킹 브랜치(`origin/main`)는 이름 그대로 합칠 수도 있습니다.

```bash
git merge origin/main
```

### push 가 거부될 때 — non-fast-forward

원격에 내가 가지고 있지 않은 커밋이 있으면 git 은 push 를 거부합니다.

```
 ! [rejected]        main -> main (non-fast-forward)
error: failed to push some refs to 'https://github.com/learner/playground.git'
```

이때는 먼저 `git pull` 로 원격 변경을 합친 뒤 다시 push 합니다. 정말로 원격을 내 쪽으로
덮어쓰려면 `git push --force` 를 쓰지만, 다른 사람이 올린 커밋이 사라질 수 있으니
혼자 쓰는 저장소가 아니면 피하세요.

> **직접 해 보기 — 거부되는 push 를 pull 로 해결하기**
> 이 실습의 `origin` 은 페이지 안의 가상 원격 저장소라서, 다른 브랜치를 원격 `main` 으로
> 올리면 "다른 곳에서 먼저 올린 커밋"과 같은 상황을 만들 수 있습니다.
>
> ```bash
> git switch -c docs
> # docs.md 파일을 새로 만들고 한 줄 적기
> git add .
> git commit -m "문서 추가"
> git push origin docs:main     # 원격 main 이 내 로컬 main 보다 앞서게 됩니다
> git switch main
> git push origin main          # ! [rejected] … (non-fast-forward)
> git pull origin main          # 받아서 합칩니다 (Fast-forward)
> git status                    # Your branch is up to date with 'origin/main'.
> ```

## 자주 쓰는 명령 한눈에 보기

| 상황 | 명령 |
| --- | --- |
| 지금 상태 확인 | `git status` |
| 변경 내용 비교 | `git diff` |
| 최근 이력 보기 | `git log --oneline` |
| 새 브랜치 만들며 이동 | `git switch -c <이름>` |
| 다른 브랜치로 이동 | `git switch <이름>` |
| 다른 브랜치 합치기 | `git merge <이름>` |
| 원격 등록·확인 | `git remote add origin <주소>`, `git remote -v` |
| 원격에 올리기 | `git push -u origin <브랜치>` |
| 원격 변경 받아 오기 | `git fetch`, `git pull` |
| 마지막 커밋으로 되돌리기 | `git reset --hard HEAD` |

## 막혔을 때

- `fatal: not a git repository` — 아직 `git init` 을 하지 않았습니다.
- `nothing to commit` — 변경이 없거나 `git add` 를 잊었습니다.
- `Already up to date.` — 합칠 것이 없습니다. `git merge feature` 를 `feature` 브랜치에서
  실행하지 않았는지, 이미 병합을 마쳤는지 확인하세요.
- `CONFLICT` — 같은 파일의 같은 부분을 양쪽에서 고쳤습니다. `<<<<<<<`, `=======`, `>>>>>>>`
  표시를 지우고 원하는 내용만 남긴 뒤 `git add .`, `git commit -m "merge"` 를 실행하세요.
- `Your local changes … would be overwritten by checkout` — 커밋하지 않은 수정이 있어
  브랜치를 바꾸면 그 수정이 지워질 상황입니다. 실제 Git 처럼 **전환이 중단**되므로,
  먼저 커밋하거나 `git switch -f feature` 로 버릴지 결정하세요. (merge 에서도 같은
  보호가 동작합니다.)
- `fatal: The current branch main has no upstream branch.` — 올릴 대상이 연결되지 않았습니다.
  `git push -u origin main` 처럼 원격과 브랜치를 함께 적어 주세요.
- `! [rejected] … (non-fast-forward)` — 원격에 내가 없는 커밋이 있습니다.
  `git pull` 로 합친 뒤 다시 push 하거나, 정말 덮어쓸 때만 `git push --force` 를 씁니다.
- `There is no tracking information for the current branch.` — `git pull` 만으로는 어느
  원격 브랜치를 받을지 모릅니다. `git pull origin main` 처럼 직접 지정하거나
  `git push -u origin main` 으로 업스트림을 먼저 연결하세요.
- `cannot rebase: You have unstaged changes` — rebase 전에 작업 트리를 정리해야 합니다.
- 실습을 처음부터 다시 하려면 오른쪽 위 `⋮` 메뉴에서 **강의 파일 초기화**를 고르세요.

여섯 미션을 모두 마치면 **자유 실습**에서 `git log --all --graph` 나 rebase, reset,
`git push origin --delete <브랜치>` 같은 명령도 시험해 보세요.

## 이 실습 엔진이 단순화한 부분

이 코스의 Git 은 브라우저 안에서 움직이는 **교육용 엔진**입니다. 명령과 결과는 실제
Git 과 같게 동작하지만, 다음은 일부러 단순하게 만들었습니다. 실제 저장소에서 같은
명령을 쓸 때 이 차이만 기억하면 됩니다.

| 실제 Git | 이 실습 엔진 |
| --- | --- |
| 객체·팩파일 단위로 내용을 저장 | 커밋마다 **폴더 전체 스냅샷**을 저장 |
| 줄 단위 3-way 병합 | 파일 단위로 비교하고, 양쪽이 다르면 충돌 표시를 넣음 |
| 40자리 SHA-1 해시 | 보기 쉽게 8자리 짧은 해시 |
| 원격과 네트워크로 통신하고 인증 | 페이지 안의 **가상 원격**과 주고받음 (주소·브랜치만 기록) |
| `git stash`, `reflog`, 훅 | 지원하지 않음 |
| rebase 충돌 시 `--continue` / `--abort` 로 이어서 진행 | 충돌하면 **전체를 원래대로 되돌림**(처음부터 다시 시도) |
| 파일 모드·심볼릭 링크·서브모듈·`.gitignore` | 지원하지 않음 |
| 작성자·시간이 실제 사용자 정보 | 학습자 고정 작성자와 연습용 시간 |

그래도 `add` / `commit` / `branch` / `switch` / `merge` / `rebase` / `reset` /
`remote` / `push` / `pull` 의 **동작 규칙**은 실제 Git 과 같습니다. 특히 커밋하지 않은
변경을 보호하는 규칙(전환·병합 거부, 커밋하지 않은 파일의 `git rm` 거부,
`merge --abort` 로 병합 전 상태 복원, `reset --hard` 가 추적되지 않은 파일을 남기는 것)과
push 의 fast-forward 검사는 그대로입니다.
