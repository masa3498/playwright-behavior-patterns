'use strict';

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ================================================================
   モックデータ
================================================================ */
const MOCK_DATA = [
  { id: 1,  programId: 'PRG-101',  programName: '顧客管理システム',     sectionCd: 'A001', tantouId: 'USR-001', status: '稼働中', updatedAt: '2025-11-01', companyCd: 'COMP-A' },
  { id: 2,  programId: 'PRG-101B', programName: '顧客履歴参照',         sectionCd: 'A001', tantouId: 'USR-002', status: '稼働中', updatedAt: '2025-10-15', companyCd: 'COMP-A' },
  { id: 3,  programId: 'PRG-102',  programName: '在庫管理システム',     sectionCd: 'B002', tantouId: 'USR-002', status: '開発中', updatedAt: '2025-12-01', companyCd: 'COMP-A' },
  { id: 4,  programId: 'PRG-103',  programName: '売上集計バッチ',       sectionCd: 'A001', tantouId: 'USR-003', status: '保守中', updatedAt: '2025-09-20', companyCd: 'COMP-A' },
  { id: 5,  programId: 'PRG-201',  programName: '請求書発行システム',   sectionCd: 'C003', tantouId: 'USR-001', status: '稼働中', updatedAt: '2025-11-30', companyCd: 'COMP-A' },
  { id: 6,  programId: 'PRG-202',  programName: '受発注管理',           sectionCd: 'B002', tantouId: 'USR-004', status: '稼働中', updatedAt: '2025-08-10', companyCd: 'COMP-A' },
  { id: 7,  programId: 'PRG-301',  programName: '人事評価システム',     sectionCd: 'D004', tantouId: 'USR-003', status: '停止中', updatedAt: '2025-07-01', companyCd: 'COMP-B' },
  { id: 8,  programId: 'PRG-302',  programName: '給与計算バッチ',       sectionCd: 'D004', tantouId: 'USR-005', status: '稼働中', updatedAt: '2025-12-15', companyCd: 'COMP-B' },
  { id: 9,  programId: 'PRG-401',  programName: 'ログ収集エージェント', sectionCd: 'E005', tantouId: 'USR-001', status: '稼働中', updatedAt: '2026-01-10', companyCd: 'COMP-B' },
  { id: 10, programId: 'PRG-402',  programName: '帳票出力システム',     sectionCd: 'C003', tantouId: 'USR-006', status: '開発中', updatedAt: '2026-02-01', companyCd: 'COMP-B' },
];

// companyCd: undefined → フィルタなし（search.html からのリクエスト）
//            string   → companyCd 完全一致フィルタ追加（search-inherited.html 正規遷移）
// null は呼び出し元でハンドリングするためここには渡されない
function filterData(freeWord, sectionCd, tantouId, companyCd) {
  const fw = (freeWord  || '').trim().toLowerCase();
  const sc = (sectionCd || '').trim().toLowerCase();
  const ti = (tantouId  || '').trim().toLowerCase();
  const cc = (typeof companyCd === 'string') ? companyCd.trim().toLowerCase() : '';

  return MOCK_DATA.filter(row => {
    const fwOk = !fw || row.programId.toLowerCase().includes(fw) || row.programName.toLowerCase().includes(fw);
    const scOk = !sc || row.sectionCd.toLowerCase().includes(sc);
    const tiOk = !ti || row.tantouId.toLowerCase().includes(ti);
    const ccOk = !cc || row.companyCd.toLowerCase() === cc;
    return fwOk && scOk && tiOk && ccOk;
  });
}

/* ================================================================
   ルーティング
================================================================ */

// JSON ボディのパース
app.use(express.json());

// root → login へリダイレクト
app.get('/', (_req, res) => {
  res.redirect('/login.html');
});

// POST /api/gateway  — LOG / SEARCH 競合リクエスト再現用エンドポイント
// Request body:
//   { events: [{ type: "LOG",    params: { ... } }] }  → 即座に { status: 'ok' } を返す
//   { events: [{ type: "SEARCH", params: { freeWord, sectionCd, tantouId[, companyCd] } }] }
//     → /api/search と同一ロジック（1〜2 秒遅延後に検索結果を返す）
//
// search.html / search-inherited.html は検索実行時に LOG + SEARCH の 2 リクエストを
// ほぼ同時にこのエンドポイントへ送信する。
// Playwright の waitForResponse('/api/gateway') では先に捕捉できるのが
// LOG レスポンスか SEARCH レスポンスかが非決定的になるため、
// events[0].type でフィルタしないと正しいレスポンスを待機できない。
app.post('/api/gateway', (req, res) => {
  const events     = req.body && Array.isArray(req.body.events) ? req.body.events : [];
  const firstEvent = events[0];

  if (!firstEvent) {
    return res.status(400).json({ error: 'events 配列が空です' });
  }

  // type: 'LOG' → 即座に ok を返す（遅延なし）
  if (firstEvent.type === 'LOG') {
    console.log('[POST /api/gateway] LOG:', JSON.stringify(firstEvent.params));
    return res.json({ status: 'ok' });
  }

  // type: 'SEARCH' → /api/search と同一ロジック
  if (firstEvent.type === 'SEARCH') {
    const params    = firstEvent.params || {};
    const { freeWord = '', sectionCd = '', tantouId = '' } = params;
    const companyCd = ('companyCd' in params) ? params.companyCd : undefined;

    const delay = Math.floor(Math.random() * 1000) + 1000;

    console.log(
      `[POST /api/gateway] SEARCH freeWord="${freeWord}" sectionCd="${sectionCd}" tantouId="${tantouId}"` +
      ` companyCd=${JSON.stringify(companyCd)} → delay=${delay}ms`
    );

    if (companyCd === null) {
      return setTimeout(() => {
        res.json({
          conditions: { freeWord, sectionCd, tantouId, companyCd: null },
          count:       0,
          results:     [],
          _meta: { delay, timestamp: new Date().toISOString() },
        });
      }, delay);
    }

    return setTimeout(() => {
      const results = filterData(freeWord, sectionCd, tantouId, companyCd);
      res.json({
        conditions: { freeWord, sectionCd, tantouId, ...(companyCd !== undefined && { companyCd }) },
        count:       results.length,
        results,
        _meta: { delay, timestamp: new Date().toISOString() },
      });
    }, delay);
  }

  // 未知の type
  return res.status(400).json({ error: '未知のイベントタイプ: ' + firstEvent.type });
});

// 静的ファイル配信 (login.html / menu.html / search.html / search-inherited.html)
// express.static でディレクトリ内のすべての .html を一括配信する
app.use(express.static(path.join(__dirname)));

/* ================================================================
   起動
================================================================ */
app.listen(PORT, () => {
  console.log('\n  Mock API Server\n');
  console.log(`  http://localhost:${PORT}/login.html            ← ログイン画面`);
  console.log(`  http://localhost:${PORT}/menu.html             ← メニュー画面`);
  console.log(`  http://localhost:${PORT}/search.html           ← 検索画面`);
  console.log(`  http://localhost:${PORT}/search-inherited.html ← 継承検索画面（メニュー経由必須）`);
  console.log(`  http://localhost:${PORT}/api/gateway           ← ゲートウェイ API（LOG / SEARCH）`);
  console.log('\n  Ctrl+C で停止\n');
});
