# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

---

## Project Overview

This framework extracts and idealizes the design essence behind a **115-screen E2E test automation** effort completed in a legacy SIer environment. The codebase contains no application logic—everything here is test infrastructure.

The central design bet: **classify tests by behavioral pattern, not by screen**. A legacy codebase with 115 screens does not need 115 Page Object classes. It needs 4. New screens are added as a single CSV row; TypeScript source files are not touched.

---

## Commands

No npm scripts are defined. Use `npx` directly:

```bash
# Prerequisites: start the mock server before running tests
cd mock-app && node server.js

# Test execution
npx playwright test                          # All tests (currently Chromium only)
npx playwright test tests/search.spec.ts     # Single spec file
npx playwright test --project=chromium       # Explicit browser selection
npx playwright test --ui                     # Interactive UI mode
npx playwright show-report                   # Open last HTML report
npx playwright install                       # Install/update browsers
```

CI behavior (controlled by the `CI` environment variable): retries increase to 2, workers drop to 1, and `test.only` calls cause build failures.

---

## Architecture

### Directory Structure

```
playwright-behavior-patterns/
├── data/
│   └── search-test-cases.csv    # Test case definitions (the only file editors touch)
├── factories/
│   └── page-factory.ts          # Factory pattern: maps patternType → Page Object class
├── mock-app/                    # Express server simulating the target application
│   ├── server.js
│   ├── login.html
│   ├── menu.html
│   ├── search.html
│   └── search-inherited.html
├── output/                      # Generated at runtime by PerfReporter (git-ignored)
│   ├── perf-log.json            # NDJSON: one SearchPerfRecord per line
│   └── perf-summary.csv         # 5-column summary for aggregation
├── pages/
│   ├── base-page.ts             # Template Method pattern: shared test flow + perf measurement
│   └── search-page.ts           # Concrete subclasses for patterns A–D
├── tests/
│   └── search.spec.ts           # Dynamically generates tests from CSV
├── types/
│   └── index.ts                 # Canonical type definitions (TestData, SearchPerfRecord)
├── utils/
│   ├── csv-loader.ts            # CSV parser (stateful, handles RFC 4180 quoting)
│   ├── form-utils.ts            # DOM coordinate-based form operations
│   └── perf-reporter.ts         # I/O delegate: writes SearchPerfRecord to output/
├── global-setup.ts              # Login → storageState persistence (runs once before all tests)
├── global-teardown.ts           # Sorts perf output by testCaseName (runs once after all tests)
└── playwright.config.ts         # baseURL, globalSetup/Teardown, storageState, Chromium
```

---

### Design Patterns

#### 1. Template Method Pattern — `pages/base-page.ts`

`BasePage` defines the **invariant test flow** as a sealed sequence of steps. Subclasses override only the steps that differ; they cannot reorder or skip the pipeline.

```
execute()
  └─ navigate()         → Go to targetPage (relative path; baseURL prepended by Playwright)
  └─ prepareForSearch() → Hook for pre-search actions (no-op by default)
  └─ submitSearch()     → Click search button; await SEARCH API response; record perf
  └─ verifyResult()     → Assert search results are rendered
```

**Flaky-test mitigation in `submitSearch()`:** The mock app sends both a `LOG` event and a `SEARCH` event to the same `/api/gateway` endpoint concurrently. A naive `waitForResponse` on URL alone is non-deterministic. The implementation disambiguates by inspecting the POST body:

```typescript
this.page.waitForResponse(async (res) => {
  if (!res.url().includes("/api/gateway")) return false;
  const body = await res.request().postDataJSON();
  return body?.events?.[0]?.type === "SEARCH";
});
```

This listener is registered via `Promise.all` together with the button click, ensuring the listener is active before the network request fires.

#### 2. Factory Pattern — `factories/page-factory.ts`

`PageFactory.createPage()` reads `patternType` from `TestData` and instantiates the appropriate `BasePage` subclass. The test spec has no knowledge of which class is used.

```
patternType "A" → SearchPagePatternA  (direct navigation, no input)
patternType "B" → SearchPagePatternB  (navigate via menu screen)
patternType "C" → SearchPagePatternC  (clear conditions before search)
patternType "D" → SearchPagePatternD  (fill search fields from CSV data)
```

Adding a new behavioral pattern requires: (1) a new subclass in `search-page.ts`, (2) a new `case` in `PageFactory`, and (3) a new letter in the `patternType` union in `types/index.ts`. The test spec and CSV loader are untouched.

#### 3. DOM Coordinate-Based Form Operations — `utils/form-utils.ts`

Pattern D fills form fields without hardcoding field IDs. Instead, `getFillableInputsSortedByPosition()` reads each visible input's bounding box and sorts by `(y, x)` — top-to-bottom, left-to-right — mirroring natural reading order. The `searchConditions` array in CSV maps positionally to this sorted list.

This is why a form field's ID changing from `freeWord` to `FreeWord` to `FreeWord_inp` never breaks a test: the selector is position, not identity.

`clearAllFormInputs()` applies the same DOM-first approach for Pattern C, clearing every visible text input and select element without relying on a "clear" button ID.

#### 4. Performance Measurement — `utils/perf-reporter.ts`

`submitSearch()` measures search response time using `performance.now()` (a monotonic clock, immune to NTP adjustments) and delegates I/O to `PerfReporter.record()`. `BasePage` itself performs no file writes.

```typescript
const startTime = performance.now();
const [response] = await Promise.all([waitForResponse(...), click()]);
const endTime = performance.now();

PerfReporter.record({
  responseTimeMs: endTime - startTime,
  serverDelayMs: body._meta.delay,
  // ...
} satisfies SearchPerfRecord);
```

`PerfReporter` writes two formats to `output/`:

| File | Format | Purpose |
|---|---|---|
| `perf-log.json` | NDJSON (1 record per line) | Full-field detail log |
| `perf-summary.csv` | 5-column CSV | Aggregation and diff review |

**Parallel-safe writes:** NDJSON uses `appendFileSync` (append is atomic at the OS level). The CSV header uses `flag: 'wx'` (exclusive create), catching `EEXIST` silently so only the first writer adds the header.

**Post-run sort:** `global-teardown.ts` runs once after all workers finish and re-sorts both files by `testCaseName` ascending. Sorting during parallel execution would create write contention; deferring to teardown guarantees exclusive file access.

---

### Data-Driven Testing — `data/search-test-cases.csv`

Test cases are defined entirely in CSV. The spec file generates `test()` registrations dynamically at collection time via a `for...of` loop over `loadTestData()`.

```csv
testCaseName,targetPage,patternType,searchConditions
TC-001_直接遷移_条件なし検索,search.html,A,
TC-005_フリーワードのみ検索,search.html,D,管理
TC-006_部門コードのみ検索,search.html,D,",A001,"
TC-007_複数条件で検索,search.html,D,"管理,A001,USR-001"
```

**`searchConditions` encoding:** The column stores an ordered, comma-separated list mapped positionally to `[freeWord, sectionCd, tantouId]`. To specify only the second field (sectionCd), use `",A001,"` — the leading and trailing commas produce empty strings for the other positions. RFC 4180 quoting is required when the value contains commas.

`csv-loader.ts` implements a stateful, character-by-character parser that correctly handles RFC 4180 quoted fields (commas inside quotes, `""` escape sequences), BOM removal, and CRLF normalization. No external dependencies.

---

### Type Safety — `types/index.ts`

All shared interfaces are defined in `types/index.ts` as the single source of truth.

```typescript
export interface TestData {
  testCaseName: string;
  targetPage: string;
  patternType: "A" | "B" | "C" | "D";
  searchConditions: string[];
}

export interface SearchPerfRecord {
  testCaseName: string;
  targetPage: string;
  patternType: "A" | "B" | "C" | "D";
  startedAt: string;       // ISO 8601 wall-clock at Promise.all registration
  endedAt: string;         // ISO 8601 wall-clock at Promise.all resolution
  responseTimeMs: number;  // performance.now() delta
  serverDelayMs?: number;  // _meta.delay from API response
}
```

`base-page.ts` re-exports `TestData` via `export type { TestData }` for backward compatibility with any legacy imports.

---

### Verification Strategy

`verifyResult()` in `BasePage` applies a two-stage assertion:

1. **`#loading-indicator` reaches `hidden` state** — confirms the async API call has resolved and the UI has processed the response.
2. **`#result-table-wrap` is `toBeVisible()`** — confirms at least one result was returned. This element is hidden by the application when the result count is zero, making `toBeVisible()` an implicit assertion that the search returned results.

Subclasses may override `verifyResult()` to add row-level or count-level assertions for specific test cases.

---

### Authentication — `global-setup.ts`

The mock app has a `login.html` screen. `globalSetup` runs once before all tests:

1. Launches a dedicated Chromium instance (fixture scope is unavailable in global setup)
2. Logs in with test credentials, awaiting navigation to `menu.html` via `Promise.all([waitForURL, click()])` — the same race-condition-safe pattern as `submitSearch()`
3. Saves browser state (cookies, sessionStorage) to `.auth/session.json`

Each test project reads this file via `storageState`, starting already authenticated. Tests never repeat the login sequence.

---

### Configuration

`playwright.config.ts` key settings:

| Setting | Value | Reason |
|---|---|---|
| `baseURL` | `http://localhost:3000` | Bare relative paths in all `page.goto()` calls |
| `globalSetup` | `./global-setup` | Login once; persist auth state |
| `globalTeardown` | `./global-teardown` | Sort perf output after all workers finish |
| `trace` | `"on"` | Always collect traces for debugging |
| `storageState` | `.auth/session.json` | Pre-authenticated browser state |
| Firefox / WebKit | commented out | Currently Chromium-only; enable when needed |

---

### Production Challenges Reproduced in the Mock

The mock app is intentionally simple, but it faithfully reproduces two E2E-specific failure modes encountered in production:

**Challenge 1 — Concurrent POST to the same endpoint:**
`search.html` and `search-inherited.html` fire a `LOG` event and a `SEARCH` event to `/api/gateway` nearly simultaneously on each search. A naive `waitForResponse('/api/gateway')` non-deterministically captures whichever arrives first. The solution: filter by `body.events[0].type === "SEARCH"`, registered before the click via `Promise.all`.

**Challenge 2 — Implicit parameter dependency via navigation path (`search-inherited.html`):**
`search-inherited.html` reads `companyCd` from `sessionStorage["transitionContext"]`. That key is written only when navigating from `menu.html` via the MENU-002 button. Visiting the URL directly leaves `companyCd` as `null`, and the server always returns 0 results. Pattern B's `navigate()` override reproduces the correct menu-first path, making the dependency explicit in the CSV (`patternType: "B"`) rather than hidden in test setup code.

---

### Extending the Framework

| Goal | Action |
|---|---|
| Add a test case | Add a row to `data/search-test-cases.csv` |
| Add a search input field | No code change needed — `getFillableInputsSortedByPosition()` picks it up by DOM order |
| Add a new navigation pattern | Add subclass in `search-page.ts` + case in `PageFactory` + letter in `patternType` union |
| Add row-level result assertions | Override `verifyResult()` in a subclass |
| Add a perf metric field | Add field to `SearchPerfRecord` in `types/index.ts`; update `PerfReporter.record()` |
| Target a different host | Change `baseURL` in `playwright.config.ts` |
| Enable Firefox / WebKit | Uncomment the relevant project blocks in `playwright.config.ts` |

---

### Coding Standards

- **Commenting Strategy**:
  - 全てのクラス、メソッドに対して、役割と設計意図を説明する **JSDoc (`/** ... */`)** を付与すること。
  - 「何をしているか（What）」よりも、**「なぜその設計・手法を選んだか（Why）」** を重点的に記述すること。
  - 特に Template Method パターンにおけるオーバーライドの意図、`Promise.all` による race condition 対策、`performance.now()` を採用した理由、`PerfReporter` への I/O 委譲の意図など、アーキテクチャ上の工夫を言語化すること。
  - 複雑なロジック（CSV パース、DOM座標ソート等）には、処理のステップごとに簡潔なインラインコメントを添えること。
  - 既存の丁寧なコメントは削除せず、そのトーンを維持して拡張すること。
  - 言語は日本語を使用し、プロフェッショナルな「だ・である」調（または丁寧なです・ます調）で統一すること。

- **Naming Convention**:
  - 変数名やメソッド名は、その責務が直感的に理解できる命名を心がけること。
