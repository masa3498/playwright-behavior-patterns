import { defineConfig, devices } from "@playwright/test";

// .env ファイルが存在する場合のみ環境変数へ読み込む（CI 環境では無視される）
try {
  process.loadEnvFile();
} catch {
  // .env ファイルが存在しない場合（CI 等）は何もしない
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  /**
   * 全テスト実行前に一度だけ呼ばれるグローバルセットアップ。
   * ログイン処理を行い、認証後のブラウザ状態を .auth/session.json へ保存する。
   * 各テストはこのファイルを storageState として読み込み、ログイン済み状態で起動する。
   */
  globalSetup: "./global-setup",

  /**
   * 全テスト実行後に一度だけ呼ばれるグローバルティアダウン。
   * 並列実行により完了順に追記された計測ログを testCaseName 昇順に並び替える。
   * ソートを teardown に委ねることで、並列書き込み中の競合を回避している。
   */
  globalTeardown: "./global-teardown",

  testDir: "./tests",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: "http://localhost:3000",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        /**
         * globalSetup が生成した認証済みブラウザ状態を読み込む。
         * Playwright の storageState はブラウザエンジン非依存の JSON 形式のため、
         * Firefox / WebKit を有効化する際も同じファイルを指定できる。
         */
        storageState: ".auth/session.json",
      },
    },

    // {
    //   name: "firefox",
    //   use: { ...devices["Desktop Firefox"] },
    // },

    // {
    //   name: "webkit",
    //   use: { ...devices["Desktop Safari"] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
