# Third-Party Notices — PKPilot 0013 (CodePlayground)

이 앱은 아래 소프트웨어와 외부 자산을 사용합니다.

## 런타임 라이브러리

| 패키지 | 라이선스 | 용도 |
| --- | --- | --- |
| [React](https://react.dev) / React DOM | MIT | UI |
| [Pyodide](https://pyodide.org) (CPython 3.13 WASM) | MPL-2.0 (CPython은 PSF-2.0, 그 외 의존 라이브러리는 각 라이선스) | Python 강의의 실제 CPython 실행. 앱 번들에는 포함하지 않고, 첫 실행 때 `cdn.jsdelivr.net`에서 내려받습니다 |

## 개발 의존성

| 패키지 | 라이선스 | 용도 |
| --- | --- | --- |
| [Vite](https://vitejs.dev) / `@vitejs/plugin-react` | MIT | 개발 서버 · 빌드 |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 | 타입 검사 |
| [Vitest](https://vitest.dev) / [happy-dom](https://github.com/capricorn86/happy-dom) | MIT | 단위 테스트 |
| [Playwright](https://playwright.dev) | Apache-2.0 | 데스크톱 · 모바일 E2E 검증 |

## 폰트 · 브랜드

앱은 방문자 기기에 설치된 시스템 폰트(Inter, Apple SD Gothic Neo, Pretendard, Noto Sans KR 등)를
우선 사용하며, 별도 웹폰트 파일을 배포하지 않습니다. HD2Lab 듀얼 스큐 마크와 OG 카드는 이 저장소의
`tools/generate_brand_assets.py`가 생성한 자체 자산입니다.
