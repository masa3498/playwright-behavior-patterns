/**
 * @fileoverview パフォーマンス計測結果のファイル出力ユーティリティ。
 *
 * `BasePage.submitSearch()` が生成した `SearchPerfRecord` を受け取り、
 * 2つの形式で `output/` ディレクトリへ永続化する責務を担う。
 *
 * - `output/perf-log.json`  … NDJSON（1行1レコード）。全フィールドを保存する詳細ログ。
 * - `output/perf-summary.csv` … 5列の集計用 CSV。運用上の集計・加工を想定した軽量フォーマット。
 *
 * この分離により、`BasePage` は I/O 責務を持たずに済み、単一責任の原則を維持できる。
 * 計測フォーマットの変更もこのファイルへの修正で完結する。
 */

import * as fs from "fs";
import * as path from "path";
import type { SearchPerfRecord } from "../types";

/** 出力先ディレクトリ。テスト実行カレントディレクトリからの相対パス。 */
const OUTPUT_DIR = "output";

/** NDJSON 形式の詳細ログファイルパス。全フィールドを保持する。 */
const JSON_PATH = path.join(OUTPUT_DIR, "perf-log.json");

/** 集計用 CSV ファイルパス。主要5列のみを保持する。 */
const CSV_PATH = path.join(OUTPUT_DIR, "perf-summary.csv");

/**
 * CSV のヘッダー行。
 * 並列実行時の重複書き込み防止のため、初回ファイル作成時にのみ書き出す。
 */
const CSV_HEADER = "testCaseName,targetPage,patternType,responseTimeMs,startedAt\n";

/**
 * パフォーマンス計測結果を JSON（NDJSON）と CSV の両ファイルへ書き出すクラス。
 *
 * すべてのメソッドをスタティックとして提供する。インスタンス化は不要であり、
 * `BasePage` サブクラスからの呼び出しが容易になるよう設計している。
 */
export class PerfReporter {
  /**
   * 計測レコードを NDJSON と CSV の両ファイルへ追記する。
   *
   * **並列実行時の安全性:**
   * `fullyParallel: true` 環境では複数 worker が同一ファイルへ同時書き込む可能性がある。
   * - NDJSON は `appendFileSync`（1行 = 1アトミック書き込み）により、行の混在を防ぐ。
   * - CSV のヘッダー行は `flag: 'wx'`（排他的新規作成）で初回のみ書き込む。
   *   既存ファイルへの書き込みは `EEXIST` エラーとなるが、これは正常な競合状態であるため
   *   捕捉して無視する。この方式により重複ヘッダーの混入を防ぐ。
   *
   * @param rec 書き出す計測レコード
   */
  static record(rec: SearchPerfRecord): void {
    // output/ ディレクトリが存在しない場合は自動作成する。
    // recursive: true により、既存ディレクトリへの呼び出しもエラーにならない。
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // NDJSON: 1行1レコードで追記する。
    // appendFileSync は OS レベルで追記操作をアトミックに扱うため、
    // 複数 worker が同時に書き込んでも行単位での混在は起きない。
    fs.appendFileSync(JSON_PATH, JSON.stringify(rec) + "\n", "utf-8");

    // CSV ヘッダーを排他的新規作成する。
    // flag: 'wx' はファイルが存在しない場合のみ作成・書き込みを行う。
    // 存在する場合は EEXIST エラーとなるが、これはヘッダーが既に書き込まれていることを
    // 意味するため、エラーを捕捉して正常として扱う。
    try {
      fs.writeFileSync(CSV_PATH, CSV_HEADER, { flag: "wx", encoding: "utf-8" });
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }

    // CSV データ行を追記する。
    // フィールドにカンマが含まれる可能性のある testCaseName と targetPage は、
    // 現在の仕様では英数字・日本語のみであり RFC 4180 クォートは不要と判断している。
    const csvLine =
      [
        rec.testCaseName,
        rec.targetPage,
        rec.patternType,
        rec.responseTimeMs,
        rec.startedAt,
      ].join(",") + "\n";
    fs.appendFileSync(CSV_PATH, csvLine, "utf-8");
  }
}
