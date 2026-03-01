/**
 * @fileoverview Playwright グローバルセットアップ。
 *
 * 全テストスイートの実行前に一度だけ呼ばれるセットアップ関数を定義する。
 * ログイン操作を行い、認証後のブラウザ状態（Cookie・sessionStorage 等）を
 * ファイルへ保存することで、各テストが毎回ログインを繰り返すコストを排除する。
 *
 * globalSetup は Playwright の test fixture スコープ外で動作するため、
 * `{ page }` fixture は利用できない。chromium を直接起動して操作する。
 */

import { chromium, expect, type FullConfig } from "@playwright/test";

/**
 * storageState の保存先パス。
 *
 * playwright.config.ts の `storageState` 設定と必ず一致させること。
 * `.auth/` ディレクトリは Playwright が自動作成するため事前作成は不要である。
 */
export const SESSION_FILE_PATH = ".auth/session.json";

/**
 * ログイン画面の DOM セレクター定数。
 *
 * login.html は PascalCase と kebab-case が混在した意図的な命名を持つ。
 * 変更箇所を一箇所に集約し、セレクターの散在を防ぐためここで定義する。
 */
const LOGIN_SELECTOR = {
  userId:      "#UserID",      // PascalCase・意図的
  password:    "#Password",    // PascalCase・意図的
  loginButton: "#btn-login",   // kebab-case・意図的
} as const;

/**
 * テスト用の認証情報。環境変数 TEST_USER_ID / TEST_PASSWORD から読み取る。
 *
 * - ローカル環境: プロジェクトルートの `.env` ファイルに値を記載する。
 *   `.env` は `.gitignore` で除外されているためコミットされない。
 * - CI 環境: Repository Secrets に登録した値をワークフロー YAML の `env:` で注入する。
 *
 * 環境変数が未設定の場合は即座にエラーを投げて設定漏れを早期検知する。
 * フォールバック値は意図的に設けていない。
 */
const userId   = process.env.TEST_USER_ID;
const password = process.env.TEST_PASSWORD;
if (!userId || !password) {
  throw new Error(
    "TEST_USER_ID または TEST_PASSWORD が設定されていません。" +
    "ローカル環境では .env ファイルを作成し、値を設定してください。"
  );
}
const LOGIN_CREDENTIALS = { userId, password };

/**
 * グローバルセットアップ関数。
 *
 * ログイン → menu.html 到達検証 → storageState 保存 の順で処理する。
 *
 * @param config - playwright.config.ts の設定オブジェクト（baseURL の取得に使用）
 */
async function globalSetup(config: FullConfig): Promise<void> {
  // baseURL を config から取得する。
  // globalSetup は fixture スコープ外のため baseURL の自動補完が効かず、
  // URL を明示的に組み立てる必要がある。
  const baseURL = config.projects[0].use.baseURL ?? "http://localhost:3000";

  // セットアップ専用の Chromium インスタンスを直接起動する。
  // ログイン処理は window.location.href リダイレクトのみであり、
  // ブラウザエンジン依存性がないため Chromium の固定選択で十分である。
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    // ステップ1: ログイン画面へ遷移する
    await page.goto(`${baseURL}/login.html`);

    // ステップ2: 認証情報を入力する
    await page.locator(LOGIN_SELECTOR.userId).fill(LOGIN_CREDENTIALS.userId);
    await page.locator(LOGIN_SELECTOR.password).fill(LOGIN_CREDENTIALS.password);

    // ステップ3: ログインボタンを押下し、遷移完了を待機する
    //
    // waitForURL を click と Promise.all で並行登録する理由:
    // login.html の doLogin() は window.location.href 代入による高速な
    // クライアントサイドナビゲーションである。click() 後に waitForURL を
    // 逐次呼ぶと、ナビゲーション完了後にリスナーが登録される race condition が
    // ごく稀に発生しうる。Promise.all でリスナーをクリックの前に登録することで
    // 確実に遷移を捕捉できる。base-page.ts の submitSearch() が採用している
    // Promise.all パターンと同じ考え方である。
    await Promise.all([
      page.waitForURL(`${baseURL}/menu.html`),
      page.locator(LOGIN_SELECTOR.loginButton).click(),
    ]);

    // ステップ4: menu.html への到達を検証アサーションとして記録する
    //
    // waitForURL はフロー制御（遷移待機）、toHaveURL は状態検証（アサーション）
    // という異なる役割を持つ。後者を明示することで、セットアップが失敗した際に
    // 「期待URL vs 実際のURL」という分かりやすいエラーメッセージが出力される。
    await expect(page).toHaveURL(`${baseURL}/menu.html`);

    // ステップ5: ブラウザ状態をファイルへ保存する
    //
    // context.storageState() は Cookie・localStorage・sessionStorage を含む
    // ブラウザ状態を JSON 形式でファイルに書き出す。
    // 各テストは playwright.config.ts の storageState 設定でこのファイルを読み込み、
    // ログイン済み状態として起動するため、テストごとのログイン操作が不要になる。
    await context.storageState({ path: SESSION_FILE_PATH });

  } finally {
    // 正常終了・例外発生いずれの場合もブラウザリソースを解放する。
    // try/finally でラップしないと、アサーション失敗時にブラウザプロセスが
    // 残存して CI 環境でのリソースリークが発生する可能性がある。
    await browser.close();
  }
}

export default globalSetup;
