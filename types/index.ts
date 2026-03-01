/**
 * @fileoverview プロジェクト全体で共有する型定義。
 *
 * 型の定義箇所を一元化することで、各モジュール間の循環参照を防ぎ、
 * インターフェースの変更が単一ファイルへの修正で完結するよう設計している。
 */

/**
 * CSVから読み込まれる1テストケース分のデータ構造。
 *
 * `patternType` は PageFactory がサブクラスを選択する際の唯一の判断基準であり、
 * テストロジックの分岐をコードではなく設定（CSV）で制御するための核となる。
 *
 * `searchConditions` は CSV の `searchConditions` 列をカンマ分割した配列で、
 * インデックスがフォームフィールドの順序に対応する（詳細は SearchPagePatternD を参照）。
 * 条件を持たないパターン（A/B/C）では空配列となる。
 */
export interface TestData {
  /** テストケースの識別子。Playwright のテスト名として表示される。 */
  testCaseName: string;
  /** 遷移先ページのパス（例: "search.html"）。baseURL と結合して URL を構成する。 */
  targetPage: string;
  /** 使用するページオブジェクトのパターンを示す識別子。PageFactory が参照する。 */
  patternType: "A" | "B" | "C" | "D";
  /** フォームへ入力する検索条件の配列。空の要素は「入力しない」を意味する。 */
  searchConditions: string[];
}

/**
 * 検索APIの1回分のパフォーマンス計測レコード。
 *
 * `perf-reporter.ts` が JSON・CSV へ書き出す単位であり、
 * `base-page.ts` の `submitSearch()` が生成して `PerfReporter.record()` へ渡す。
 *
 * I/O 責務を `BasePage` から分離するための境界型として機能し、
 * 計測データの構造を単一箇所で定義することで将来のフィールド追加を容易にする。
 */
export interface SearchPerfRecord {
  /** テストケース名（CSV の testCaseName 列と同値） */
  testCaseName: string;
  /** 遷移先ページの相対パス */
  targetPage: string;
  /** パターン種別 */
  patternType: "A" | "B" | "C" | "D";
  /** リクエスト送信前（Promise.all 登録直前）の wall-clock 時刻（ISO 8601） */
  startedAt: string;
  /** レスポンス受信後（Promise.all 解決直後）の wall-clock 時刻（ISO 8601） */
  endedAt: string;
  /** startedAt から endedAt までの経過時間 (ms) */
  responseTimeMs: number;
  /** サーバーが応答に施加した遅延 (ms)。_meta.delay から取得。取得不可時は undefined */
  serverDelayMs?: number;
}
