/**
 * @fileoverview Playwright グローバルティアダウン。
 *
 * 全テストスイートの実行後に一度だけ呼ばれるティアダウン関数を定義する。
 * テスト実行中は並列 worker が完了順に計測レコードを追記するため、
 * 出力ファイルの行順は非決定的になる。本ティアダウンで全テスト終了後に
 * testCaseName の昇順へ並び替えることで、レビューや差分確認を容易にする。
 *
 * ソート処理をここに集約する理由:
 * - PerfReporter.record() はテスト実行中（並列）に呼ばれるため、
 *   その場でソートすると他 worker の書き込みと競合する。
 * - globalTeardown は全 worker が完了した後に単一プロセスで実行されるため、
 *   ファイルへの排他的なアクセスが保証される。
 */

import * as fs from "fs";
import * as path from "path";
import type { SearchPerfRecord } from "./types";

/** `perf-reporter.ts` と合わせて一致させる出力先パス定数 */
const OUTPUT_DIR = "output";
const JSON_PATH = path.join(OUTPUT_DIR, "perf-log.json");
const CSV_PATH = path.join(OUTPUT_DIR, "perf-summary.csv");
const CSV_HEADER = "testCaseName,targetPage,patternType,responseTimeMs,startedAt\n";

/**
 * グローバルティアダウン関数。
 *
 * NDJSON と CSV の両ファイルを testCaseName の昇順に並び替えて上書きする。
 * ファイルが存在しない場合（テストが全件スキップされた等）は何もしない。
 */
async function globalTeardown(): Promise<void> {
  sortNDJSON();
  sortCSV();
}

/**
 * `perf-log.json`（NDJSON）を testCaseName 昇順に並び替えて上書きする。
 *
 * 各行を JSON としてパースしてから sort することで、
 * 文字列操作による誤りを防ぎ、型安全なソートを実現する。
 */
function sortNDJSON(): void {
  if (!fs.existsSync(JSON_PATH)) return;

  const content = fs.readFileSync(JSON_PATH, "utf-8");
  // 末尾の空行を除外してから各行をパースする
  const records = content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as SearchPerfRecord);

  records.sort((a, b) => a.testCaseName.localeCompare(b.testCaseName, "ja"));

  fs.writeFileSync(
    JSON_PATH,
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf-8",
  );
}

/**
 * `perf-summary.csv` を testCaseName（第1列）昇順に並び替えて上書きする。
 *
 * ヘッダー行を先頭に固定したまま、データ行のみをソートする。
 */
function sortCSV(): void {
  if (!fs.existsSync(CSV_PATH)) return;

  const content = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim() !== "");

  // 先頭行はヘッダーのため除外し、データ行のみをソート対象とする
  const dataLines = lines.slice(1);
  dataLines.sort((a, b) => {
    const nameA = a.split(",")[0];
    const nameB = b.split(",")[0];
    return nameA.localeCompare(nameB, "ja");
  });

  fs.writeFileSync(CSV_PATH, CSV_HEADER + dataLines.join("\n") + "\n", "utf-8");
}

export default globalTeardown;
