/**
 * @fileoverview ページオブジェクト生成のためのファクトリークラス。
 *
 * テストスペックや CSV ローダーは、具体的なページオブジェクトのクラスを
 * 知る必要がない。patternType という識別子のみを渡すことで、
 * どのサブクラスを使うかという判断をこのファクトリーに集約する。
 * 新しいパターンの追加時に修正が必要なのはこのファイルと search-page.ts のみ。
 */

import { Page } from "@playwright/test";
import { TestData } from "../types";
import { BasePage } from "../pages/base-page";
import {
  SearchPagePatternA,
  SearchPagePatternB,
  SearchPagePatternC,
  SearchPagePatternD,
} from "../pages/search-page";

/**
 * `TestData.patternType` に基づいて適切なページオブジェクトを生成するファクトリー。
 */
export class PageFactory {
  /**
   * patternType に対応する BasePage サブクラスのインスタンスを返す。
   *
   * テストスペックはこのメソッドが返す BasePage の `execute()` を呼ぶだけでよく、
   * 具体的なクラスへの依存を持たない。ポリモーフィズムにより、
   * テストコードを一切変更せずにパターンを追加・変更できる。
   *
   * @param page     Playwright の Page インスタンス（test fixture から受け取る）
   * @param testData CSV から読み込んだ1テストケース分のデータ
   * @returns        patternType に対応する BasePage サブクラスのインスタンス
   */
  static createPage(page: Page, testData: TestData): BasePage {
    switch (testData.patternType) {
      case "A":
        return new SearchPagePatternA(page, testData);
      case "B":
        return new SearchPagePatternB(page, testData);
      case "C":
        return new SearchPagePatternC(page, testData);
      case "D":
        return new SearchPagePatternD(page, testData);
    }
  }
}
