/**
 * @fileoverview 検索画面の振る舞いパターンを定義するサブクラス群。
 *
 * 各クラスは BasePage のテストフローを継承しつつ、画面への到達方法や
 * 検索条件の入力有無といった「差分」のみをオーバーライドで表現する。
 * パターンの追加は新しいサブクラスの定義と PageFactory へのケース追加のみで完結し、
 * 既存パターンや BasePage を変更する必要がない（Open/Closed Principle）。
 */

import { BasePage } from "./base-page";
import {
  clearAllFormInputs,
  getFillableInputsSortedByPosition,
} from "../utils/form-utils";

/**
 * パターンA: URL直接遷移 + 条件なし検索。
 *
 * BasePage のデフォルト実装がそのままこのパターンの振る舞いと一致するため、
 * オーバーライドは不要。クラスとして存在することで、PageFactory が
 * インスタンスを生成できる対象として識別できる。
 */
export class SearchPagePatternA extends BasePage {}

/**
 * パターンB: メニュー画面経由遷移 + 条件なし検索。
 *
 * URL 直打ちではなく、前画面（メニュー）からのナビゲーションを経由することで、
 * セッション引き継ぎや前画面操作による状態変化を含めたシナリオを検証する。
 * `navigate()` のみをオーバーライドし、それ以降のフローは BasePage に委譲する。
 */
export class SearchPagePatternB extends BasePage {
  /**
   * メニュー画面を経由して検索画面へ遷移する。
   *
   * ボタンの特定には `a[href="${targetPage}"]` の動的セレクターを使用する。
   * ID（例: #btn-menu-prg101）でハードコードすると遷移先ごとにセレクターを
   * 追加・管理する必要が生じるが、href 属性を基準にすることで testData.targetPage
   * さえ正しければ対象リンクを自動的に特定できる。メニュー画面のボタンは
   * `<a href="...">` として実装されているため、この方式が成立する。
   *
   * `waitForURL` で遷移完了を明示的に待機することで、次ステップの DOM 操作が
   * 遷移中に実行されることを防ぐ。
   */
  protected async navigate(): Promise<void> {
    await this.page.goto("/menu.html");
    await this.page.locator(`a[href="${this.testData.targetPage}"]`).click();
    await this.page.waitForURL(`**/${this.testData.targetPage}`);
  }
}

/**
 * パターンC: 条件クリア後 + 条件なし検索。
 *
 * セッションストレージや URL パラメータによって前回の検索条件が
 * 画面に残存している状況を想定したパターン。全入力要素をクリアしてから
 * 検索することで、初期状態（全件検索）での動作を検証する。
 */
export class SearchPagePatternC extends BasePage {
  /**
   * 画面上の全入力要素を DOM 順にクリアし、検索条件を初期化する。
   *
   * クリアボタンの ID（例: `#btn-cond-clear`）をハードコードする実装では、
   * ボタン ID の変更やクリアボタンを持たない画面への転用時に追加修正が生じる。
   * `clearAllFormInputs` によって DOM を直接操作することで、画面構造に依存しない
   * 汎用的なクリアを実現している。
   *
   * クリア後の値の空確認（再検証）は `clearAllFormInputs` 内で `expect` を用いて
   * 行われる。これにより、後続の検索ステップが意図しない条件を持たないことを保証する。
   */
  protected async prepareForSearch(): Promise<void> {
    await clearAllFormInputs(this.page);
  }
}

/**
 * パターンD: 検索条件入力 + 検索。
 *
 * CSV の `searchConditions` 列から渡された条件を各フォームフィールドへ入力する。
 *
 * 特定のフィールドのみを入力したい場合（例: 部門コードのみ）は、
 * CSV で `",A001,"` のように空要素で位置を明示する。
 */
export class SearchPagePatternD extends BasePage {
  /**
   * testData.searchConditions の各要素を対応するフォームフィールドへ入力する。
   *
   * 値が undefined または空文字の場合はフィールドへの操作を行わない。
   * これにより、「入力しない = 絞り込み条件として使用しない」という意図を
   * コードの分岐で表現できる。
   */
  protected async prepareForSearch(): Promise<void> {
    // 画面座標の読み取り順（左→右、上→下）に並んだフィールド一覧を取得する。
    // フィールド ID をハードコードしないことで、フォーム構造の変更に対して
    // このメソッドが無修正で追従できる。対応関係は「左上から数えて何番目か」という
    // 位置インデックスのみで決まり、CSV の searchConditions と 1:1 で一致する。
    const inputs = await getFillableInputsSortedByPosition(this.page);

    for (let i = 0; i < this.testData.searchConditions.length; i++) {
      const value = this.testData.searchConditions[i];

      // 空要素（CSV で ",A001," のように位置を明示した空フィールド）は
      // 「このフィールドには入力しない」という意図を表すためスキップする。
      if (value === undefined || value === "") continue;

      // searchConditions の要素数が画面のフィールド数を超えた場合は安全に終了する。
      if (i >= inputs.length) break;

      await inputs[i].fill(value);
    }
  }
}
