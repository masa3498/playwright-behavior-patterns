/**
 * @fileoverview 検索画面テストの基底クラス。
 *
 * Template Method パターンを採用し、全検索画面に共通するテストフローを
 * `execute()` に固定する。画面固有の振る舞いはサブクラスへの委譲によって実現し、
 * フローの順序やステップ間の依存関係をサブクラスが誤って変更できない構造とする。
 */

import fs from "fs";
import path from "path";

import { expect, Page } from "@playwright/test";
import { TestData } from "../types";
import type { SearchPerfRecord } from "../types";
import { PerfReporter } from "../utils/perf-reporter";

// base-page.ts を直接参照している既存コードの後方互換性を維持するための再エクスポート。
// 新規コードは types/index.ts から直接インポートすること。
export type { TestData };

/**
 * `/api/gateway` が返す検索 API レスポンスの型。
 * `submitSearch()` の戻り値に型安全性を与えるための内部型であり、
 * このモジュール外への公開は意図しない。
 */
interface SearchApiResponse {
  conditions: Record<string, unknown>;
  count: number;
  results: Record<string, unknown>[];
  /** レスポンスに付随するメタ情報。既知フィールドを明示し、未知フィールドはインデックス型で受け入れる。 */
  _meta: {
    /** モックサーバーが意図的に施加した遅延時間 (ms)。計測値との比較に使用する。 */
    delay?: number;
    [key: string]: unknown;
  };
}

/**
 * テスト対象画面のセレクター定数。
 * 文字列リテラルをコード全体に散在させず、変更時の修正箇所を1箇所に集約する。
 */
const SELECTOR = {
  searchButton: "#btn-srch-main",
  loadingIndicator: "#loading-indicator",
  /** 検索結果が1件以上ある場合にのみ表示されるラッパー要素。 */
  resultsSection: "#result-table-wrap",
  resultCount: "#result-count",
} as const;

/**
 * 全検索画面テストの基底クラス。
 *
 * `execute()` が定義するテストフローは以下の5ステップで固定される:
 * 1. `navigate()`          — 対象ページへ遷移する
 * 2. `prepareForSearch()`  — 検索実行前の事前操作を行う（デフォルトは何もしない）
 * 3. `submitSearch()`      — 検索ボタンを押下し、API レスポンスを待機する
 * 4. `verifyResult()`      — 検索結果が正しく表示されていることを検証する
 * 5. `captureScreenshot()` — 検索結果画面のスクリーンショットを保存する
 *
 * 各ステップは `protected` メソッドとして公開されており、サブクラスは
 * 必要なステップのみをオーバーライドして振る舞いを変更できる。
 */
export abstract class BasePage {
  constructor(
    protected readonly page: Page,
    protected readonly testData: TestData,
  ) {}

  /**
   * テストの全フローを順番に実行するテンプレートメソッド。
   *
   * サブクラスはこのメソッドをオーバーライドしてはならない。
   * フローの変更が必要な場合は、個々のステップメソッドをオーバーライドすること。
   */
  async execute(): Promise<void> {
    await this.navigate();
    await this.prepareForSearch();
    await this.submitSearch();
    await this.verifyResult();
    await this.captureScreenshot();
  }

  /**
   * テスト対象ページへ遷移する。
   *
   * 相対パスを渡すことで、playwright.config.ts の `baseURL` との結合を
   * Playwright ランタイムに委譲する。URL のホスト変更は config の1箇所で完結する。
   */
  protected async navigate(): Promise<void> {
    await this.page.goto(this.testData.targetPage);
  }

  /**
   * 検索ボタン押下前の事前操作を行うフック。
   *
   * デフォルトは何もしない（パターン A の動作）。
   * 条件クリアや入力操作が必要なパターンはこのメソッドをオーバーライドする。
   */
  protected async prepareForSearch(): Promise<void> {}

  /**
   * 検索ボタンを押下し、検索 API のレスポンスを待機して返す。
   *
   * `waitForResponse` と `click()` を `Promise.all` で同時に登録・実行するのは、
   * click 後にリスナーを登録すると、高速な環境でレスポンスの受信に乗り遅れる
   * race condition を防ぐためである。
   *
   * また、`/api/gateway` には LOG イベントと SEARCH イベントが同一エンドポイントへ
   * 同時送信される。URL のみでフィルタリングすると LOG レスポンスを先に捕捉してしまう
   * 可能性があるため、以下の3条件を組み合わせて SEARCH レスポンスを確実に識別する:
   * 1. HTTPメソッドが POST であること（GETによる静的リソース取得を除外する）
   * 2. HTTPステータスが 200 であること（エラーレスポンスを除外する）
   * 3. リクエストボディの `events[0].type` が "SEARCH" であること（LOGイベントを除外する）
   *
   * **計測ロジック:**
   * `Promise.all` の直前・直後に `new Date()` で wall-clock 時刻を記録し、
   * その差分をレスポンスタイムとする。計測値は `PerfReporter.record()` を通じて
   * ファイルへ委譲することで、このクラスが I/O 責務を持たない設計を維持する。
   *
   * @returns 検索 API のレスポンスボディ
   */
  protected async submitSearch(): Promise<SearchApiResponse> {
    // 計測開始: Promise.all 登録直前に wall-clock 時刻と高精度タイマーを同時に取得する。
    // startedAt は ISO 8601 文字列としてログへ記録するための wall-clock 時刻であり、
    // startTime は responseTimeMs の算出専用の高精度タイマー値である。
    // performance.now() は Date と異なりモノトニッククロックであるため、
    // NTP 補正などのシステム時刻変更に影響されない安定した計測が可能である。
    const startedAt = new Date();
    const startTime = performance.now();

    const [response] = await Promise.all([
      this.page.waitForResponse(async (res) => {
        if (!res.url().includes("/api/gateway")) return false;
        // GET リクエスト（静的アセット等）を除外する
        if (res.request().method() !== "POST") return false;
        // エラーレスポンス（4xx / 5xx 等）を除外する
        if (res.status() !== 200) return false;
        try {
          const body = await res.request().postDataJSON();
          return body?.events?.[0]?.type === "SEARCH";
        } catch {
          // ボディが JSON でないレスポンス（静的アセット等）は無視する
          return false;
        }
      }),
      this.page.locator(SELECTOR.searchButton).click(),
    ]);

    // 計測終了: レスポンス受信（Promise.all 解決）直後に高精度タイマーと wall-clock を取得する。
    const endTime = performance.now();
    const endedAt = new Date();

    // レスポンスボディを一度だけ解析する。
    // response.json() は2回呼び出せないため、変数に保持して戻り値と計測の両方に使う。
    const body = (await response.json()) as SearchApiResponse;

    // 計測レコードをファイルへ書き出す。
    // PerfReporter への委譲により、BasePage は I/O 責務を持たずに済む。
    // _meta.delay は SearchApiResponse の型定義で number | undefined として明示されているため、
    // typeof チェックやキャストは不要である。
    PerfReporter.record({
      testCaseName: this.testData.testCaseName,
      targetPage: this.testData.targetPage,
      patternType: this.testData.patternType,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      responseTimeMs: endTime - startTime,
      serverDelayMs: body._meta.delay,
    } satisfies SearchPerfRecord);

    return body;
  }

  /**
   * 検索結果が正しく表示されていることを検証する。
   *
   * 検証は2段階で行う:
   * 1. ローディングインジケータの消滅を待機することで、非同期処理の完了を保証する。
   *    この待機を省略すると、レンダリング途中の DOM に対してアサーションが走り
   *    Flaky テストの原因となる。
   * 2. `#result-table-wrap` の可視性を検証する。このラッパーはアプリケーション側の
   *    仕様として検索結果が0件のときに hidden となるため、`toBeVisible()` は
   *    「1件以上ヒットした」ことの暗黙的な検証も兼ねる。
   *
   * より詳細な検証（件数・行データ）が必要なケースはこのメソッドをオーバーライドする。
   */
  protected async verifyResult(): Promise<void> {
    await this.page
      .locator(SELECTOR.loadingIndicator)
      .waitFor({ state: "hidden" });

    await expect(this.page.locator(SELECTOR.resultsSection)).toBeVisible();
  }

  /**
   * 検索結果画面のスクリーンショットを `output/screenshots/` へ保存する。
   *
   * `verifyResult()` の後に呼ばれることで、アサーション通過済み（検索結果が
   * 確実に表示されている）状態のエビデンスを取得できる。
   *
   * ファイル名は CSV 由来の `testCaseName` を使用する。`testCaseName` は
   * テストケース間で一意であるため、名前衝突は発生しない。
   * `--repeat-each` オプションで繰り返し実行した場合は同一パスへの上書きとなり、
   * 最終実行分の1枚のみが残る。
   *
   * スクリーンショットは `page` オブジェクトと密結合であるため、
   * `PerfReporter` のような外部委譲は行わず、このメソッド内で完結させる。
   */
  protected async captureScreenshot(): Promise<void> {
    const screenshotDir = path.join("output", "screenshots");
    // ディレクトリが存在しない場合は再帰的に作成する。
    // 並列実行環境では複数ワーカーが同時に mkdirSync を呼ぶ可能性があるが、
    // `recursive: true` はディレクトリが既存でも例外を投げないため安全である。
    fs.mkdirSync(screenshotDir, { recursive: true });

    const fileName = `${this.testData.testCaseName}.png`;
    const filePath = path.join(screenshotDir, fileName);

    await this.page.screenshot({ path: filePath, fullPage: true });
  }
}
