/**
 * @fileoverview テストデータ用 CSV ローダー。
 *
 * 外部ライブラリを使用せず Node.js 標準モジュールのみで実装している。
 * テスト実行環境への依存を最小化し、CI での追加インストール無しに動作させるための選択。
 */

import * as fs from "fs";
import * as path from "path";
import { TestData } from "../types";

/**
 * RFC 4180 に準拠した CSV の1行をフィールドの配列へ分解する。
 *
 * 標準の `String.split(",")` ではクォートされたフィールド内のカンマを
 * 区切り文字と誤認するため、ステートマシンで文字を1つずつ評価する。
 *
 * @param line - 解析対象の CSV 1行（改行文字を含まないこと）
 * @returns フィールド文字列の配列（クォートは除去済み）
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      // RFC 4180: クォート内の "" はエスケープされた " として扱う
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // エスケープシーケンスの2文字目をスキップ
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      // クォート外のカンマのみをフィールド区切りとみなす
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  // ループ後に残った最終フィールドを追加（末尾カンマなし形式への対応）
  result.push(current);
  return result;
}

/**
 * 指定パスの CSV ファイルを読み込み、TestData の配列として返す。
 *
 * 1行目をヘッダー行として扱い、以降の各行をヘッダー名をキーとした
 * オブジェクトへマッピングする。空行は自動でスキップされる。
 *
 * `searchConditions` 列はカンマ区切りの文字列として格納されており、
 * 本関数内で配列へ変換する。複数条件を含む場合は RFC 4180 のクォートで
 * 囲う必要がある（例: `"管理,A001,USR-001"`）。
 *
 * @param csvPath - CSV ファイルへの絶対パスまたは相対パス
 * @returns TestData の配列（ヘッダー行は含まない）
 */
export function loadTestData(csvPath: string): TestData[] {
  const absolutePath = path.resolve(csvPath);
  const raw = fs.readFileSync(absolutePath, "utf-8");

  // BOM 除去・CRLF 正規化: Excelで保存されたCSVへの対応
  const content = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = content.split("\n").filter((line) => line.trim() !== "");

  const headers = parseCSVLine(lines[0]).map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);

    // ヘッダー名をキー、セル値を値とするオブジェクトへ変換
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = (values[i] ?? "").trim();
    });

    return {
      testCaseName: row.testCaseName,
      targetPage: row.targetPage,
      patternType: row.patternType as TestData["patternType"],
      // 空セルの場合は空配列とし、SearchPagePatternD 側でのガード処理を不要にする
      searchConditions: row.searchConditions
        ? row.searchConditions.split(",").map((s) => s.trim())
        : [],
    };
  });
}
