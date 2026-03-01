/**
 * @fileoverview フォーム操作に関する汎用ユーティリティ関数群。
 *
 * 特定の画面構造やボタン ID に依存せず、DOM を直接操作することで
 * 任意のフォーム画面へ転用できる再利用可能なロジックをまとめる。
 */

import { expect, Locator, Page } from "@playwright/test";

/**
 * クリア対象とする入力要素のセレクター。
 *
 * `hidden` / `submit` / `button` / `checkbox` / `radio` は操作対象外として
 * 明示的に除外する。これらはユーザーが「値を入力する」フィールドではなく、
 * 誤って fill/selectOption を呼ぶとフォームの送信や UI の破壊につながるためである。
 * `select` を含めることで、将来のフォーム拡張（プルダウン追加など）にも追加修正なしで対応できる。
 */
const CLEARABLE_INPUT_SELECTOR =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
  ':not([type="checkbox"]):not([type="radio"]), select';

/**
 * ページ上の全入力要素（input・select）を DOM 順でクリアし、クリア後の値を再検証する。
 *
 * クリアボタンの ID をハードコードする実装では、ボタン ID の変更や
 * ボタンを持たない画面への転用時に追加修正が生じる。
 * 本関数は DOM を直接操作することで「ボタンが何という ID か」を問わず
 * フォームを初期化できる汎用性を実現している。
 *
 * クリア後に `expect` で値の空確認（再検証）を行うのは、`fill('')` が
 * 実際にブラウザへ反映されたことを Playwright レベルで保証するためである。
 * React 等のフレームワークが値バインディングを上書きする場合に備え、
 * 失敗時は再試行してから最終検証を行うフォールバック処理を組み込んでいる。
 *
 * @param page - Playwright の `Page` オブジェクト
 */
export async function clearAllFormInputs(page: Page): Promise<void> {
  const inputs = page.locator(CLEARABLE_INPUT_SELECTOR);
  const count = await inputs.count();

  for (let i = 0; i < count; i++) {
    const field = inputs.nth(i);

    // 非表示要素は操作対象外とする。
    // 画面に存在しない input（例: 条件付き表示フィールド）に対して
    // fill を呼ぶと予期しないエラーが発生するため、スキップする。
    if (!(await field.isVisible())) continue;

    const tagName = await field.evaluate((el) => el.tagName.toLowerCase());

    if (tagName === "select") {
      // select 要素の「クリア」は「最初のオプション（初期状態）へ戻すこと」を意味する。
      // 空文字への fill は select には適用できないため、index: 0 を指定する。
      await field.selectOption({ index: 0 });
      const firstOptionValue = await field.evaluate<string, HTMLSelectElement>(
        (el) => el.options[0]?.value ?? ""
      );
      try {
        await expect(field).toHaveValue(firstOptionValue);
      } catch {
        // フォールバック: 一度の selectOption で初期化されなかった場合に再試行する。
        await field.selectOption({ index: 0 });
        await expect(field).toHaveValue(firstOptionValue);
      }
    } else {
      // text 系 input: 空文字で上書きし、クリアされたことを expect で再検証する。
      await field.fill("");
      try {
        await expect(field).toHaveValue("");
      } catch {
        // フォールバック: React など値のバインディングが fill を上書きする場合に
        // 再度クリアしてから最終検証を行う。
        await field.fill("");
        await expect(field).toHaveValue("");
      }
    }
  }
}

/**
 * ページ上の全入力要素を、画面座標（左→右、上→下）の読み取り順に並べて返す。
 *
 * フィールドの ID や name をハードコードする実装では、
 * フォーム構造の変更（フィールド追加・ID 変更）のたびにテストコードの修正が必要になる。
 * 本関数は画面上の視覚的な配置座標のみを根拠にフィールドを順序付けることで、
 * CSV の searchConditions の位置インデックスとフォームフィールドの対応を
 * 「左上から数えて何番目か」という直感的なルールで成立させる。
 *
 * ソートアルゴリズム:
 *   1. 各フィールドの bounding box から (x, y) を取得する。
 *   2. y 昇順で一次ソートし、ROW_TOLERANCE 以内の y 差を「同一行」とみなしてグルーピングする。
 *      （フォームレイアウトによってフィールド高さが微妙にずれる場合に対応するための許容幅）
 *   3. 各行の内部を x 昇順にソートすることで、「1 行目：左→右、2 行目：左→右」
 *      という自然な読み取り順を実現する。
 *
 * @param page - Playwright の `Page` オブジェクト
 * @returns 画面読み取り順に並んだ、表示中の入力要素 Locator の配列
 */
export async function getFillableInputsSortedByPosition(
  page: Page
): Promise<Locator[]> {
  /** 同一行とみなす y 座標の許容差（px）。 */
  const ROW_TOLERANCE = 10;

  const inputs = page.locator(CLEARABLE_INPUT_SELECTOR);
  const count = await inputs.count();

  // 可視要素のみを対象に、bounding box を取得して一時リストへ格納する。
  const items: { locator: Locator; x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const field = inputs.nth(i);
    if (!(await field.isVisible())) continue;
    const box = await field.boundingBox();
    // bounding box が取得できない要素（レンダリング外）はスキップする。
    if (!box) continue;
    items.push({ locator: field, x: box.x, y: box.y });
  }

  // y 昇順（行方向）でまず並べ、同 y の場合は x 昇順（列方向）で整列する。
  items.sort((a, b) => a.y - b.y || a.x - b.x);

  // ROW_TOLERANCE を使って近似行にグルーピングし、各行内を x 昇順に確定させる。
  // ソート済みのため、各グループの先頭要素が行内の最小 y を保持する。
  const rows: { locator: Locator; x: number; y: number }[][] = [];
  for (const item of items) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(item.y - lastRow[0].y) <= ROW_TOLERANCE) {
      lastRow.push(item);
    } else {
      rows.push([item]);
    }
  }

  return rows.flatMap((row) =>
    row.sort((a, b) => a.x - b.x).map((item) => item.locator)
  );
}
