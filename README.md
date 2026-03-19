# 🛒 Coupang MCP Server

쿠팡(Coupang) 상품 정보를 조회할 수 있는 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 서버입니다.

Claude Code, Cursor, VS Code Copilot, ChatGPT Desktop 등 MCP를 지원하는 AI 클라이언트에서 쿠팡 상품 검색, 가격 비교, 재고 확인, 리뷰 조회를 자연어로 수행할 수 있습니다.

## 주요 기능

| 도구 | 설명 |
|------|------|
| `coupang_search_products` | 키워드로 상품 검색 (추천순, 가격순, 판매량순 정렬) |
| `coupang_get_price` | 상품 상세 가격 조회 (할인가, 원가, 할인율, 배송 정보) |
| `coupang_check_inventory` | 재고 상태, 배송 정보, 판매자 확인 |
| `coupang_get_reviews` | 상품 리뷰 조회 (평점, 내용, 작성일) |

## 동작 방식

Chrome 브라우저의 [CDP (Chrome DevTools Protocol)](https://chromedevtools.github.io/devtools-protocol/)를 통해 쿠팡 웹사이트에 접근합니다. 별도의 API 키가 필요 없습니다.

```
AI 클라이언트 → MCP 서버 → Chrome CDP → coupang.com
```

## 설치

### 1. 프로젝트 클론 및 빌드

```bash
git clone https://github.com/burlesquer/coupang-mcp.git
cd coupang-mcp
npm install
npm run build
```

### 2. Playwright 설치

```bash
npx playwright install chromium
```

### 3. Chrome 디버깅 모드 실행

MCP 서버가 Chrome에 연결하기 위해 디버깅 포트를 열어야 합니다.

**Windows (Win+R 또는 PowerShell):**
```
C:\Program Files\Google\Chrome\Application\chrome.exe --remote-debugging-port=9222 --user-data-dir="C:/ChromeTEMP"
```

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="/tmp/ChromeTEMP"
```

**Linux:**
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="/tmp/ChromeTEMP"
```

> **중요:** 기존 Chrome을 모두 종료한 후 실행해야 디버깅 포트가 활성화됩니다. `--user-data-dir`로 별도 프로필을 지정해야 기존 Chrome과 충돌하지 않습니다.

## MCP 클라이언트 설정

### Claude Code

**글로벌 등록 (모든 프로젝트에서 사용):**

```bash
claude mcp add coupang node /path/to/coupang-mcp/dist/index.js
```

**프로젝트 스코프 (현재 프로젝트에서만 사용):**

프로젝트 루트에 `.mcp.json` 생성:

```json
{
  "mcpServers": {
    "coupang": {
      "command": "node",
      "args": ["/path/to/coupang-mcp/dist/index.js"]
    }
  }
}
```

### Claude Desktop

`Settings → Developer → Edit Config`에서 `claude_desktop_config.json` 편집:

```json
{
  "mcpServers": {
    "coupang": {
      "command": "node",
      "args": ["/path/to/coupang-mcp/dist/index.js"]
    }
  }
}
```

### Cursor

Settings → MCP Servers에 추가:

```json
{
  "mcpServers": {
    "coupang": {
      "command": "node",
      "args": ["/path/to/coupang-mcp/dist/index.js"]
    }
  }
}
```

### 기타 MCP 지원 클라이언트

VS Code (Copilot), Windsurf, ChatGPT Desktop, Cline 등 MCP를 지원하는 모든 클라이언트에서 동일한 설정 형식으로 사용할 수 있습니다.

### 환경 변수 (선택)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `COUPANG_CDP_URL` | `http://localhost:9222` | Chrome CDP 연결 URL |

## 사용 예시

MCP 클라이언트에서 자연어로 요청하면 됩니다:

```
"쿠팡에서 무선이어폰 검색해줘"
"에어팟 프로 가격 비교해줘"
"상품 ID 8443849352 재고 확인해줘"
"상품 ID 8443849352 리뷰 보여줘"
"맥미니 낮은 가격순으로 찾아봐"
```

### 검색 정렬 옵션

| 옵션 | 설명 |
|------|------|
| `scoreDesc` | 쿠팡 추천순 (기본값) |
| `salePriceAsc` | 낮은 가격순 |
| `salePriceDesc` | 높은 가격순 |
| `saleCountDesc` | 판매량순 |

## 기술 스택

- **TypeScript** + **Node.js**
- **[@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)** — MCP 프로토콜 구현
- **[Playwright](https://playwright.dev/)** — Chrome CDP 연결 및 페이지 파싱
- **[Zod](https://zod.dev/)** — 입력 스키마 검증

## 제한 사항

- Chrome이 디버깅 모드(`--remote-debugging-port=9222`)로 실행 중이어야 합니다
- 쿠팡 웹사이트 구조 변경 시 셀렉터 업데이트가 필요할 수 있습니다
- 과도한 요청 시 쿠팡에서 일시적으로 차단될 수 있습니다

## 라이선스

ISC
