/**
 * @fileoverview 検索画面 E2E テストスペック。
 *
 * テストケースの定義は CSV に委譲し、このファイルはデータの読み込みと
 * テストの登録のみを担う。新規テストケースの追加は CSV 編集のみで完結し、
 * このファイルへの変更は不要である。
 */

import { test } from "@playwright/test";
import * as path from "path";
import { loadTestData } from "../utils/csv-loader";
import { PageFactory } from "../factories/page-factory";

// モジュール評価時（テスト収集フェーズ）に CSV を読み込む。
// Playwright はファイルを import した段階で test() の登録を収集するため、
// 動的なテストケース数を確定させるにはトップレベルでの読み込みが必要。
const testDataList = loadTestData(
  path.resolve(__dirname, "../data/search-test-cases.csv"),
);

// 各行を独立したテストケースとして登録する。
// testCaseName をそのままテスト名に使用することで、
// Playwright レポート上でCSVの行と1対1で対応させる。
for (const data of testDataList) {
  test(data.testCaseName, async ({ page }) => {
    const pageObj = PageFactory.createPage(page, data);
    await pageObj.execute();
  });
}
