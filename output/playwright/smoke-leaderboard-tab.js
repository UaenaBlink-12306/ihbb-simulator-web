// Smoke test: student dashboard Leaderboard tab.
// 1) Tab opens straight to the Class board (Global Top 100 was removed).
// 2) Class board renders rows from get_leaderboard_class without "Failed".
// 3) No get_leaderboard_global call and no global panel markup remains.
// Supabase is mocked so no real account is needed (see memory:
// ihbb-smoke-test-mocked-supabase).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8933;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = __dirname;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, BASE).pathname);
      let filePath = path.join(ROOT, urlPath === '/' ? 'student.html' : urlPath);
      if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function fail(msg) {
  console.error('FAIL: ' + msg);
  process.exitCode = 1;
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  const GLOBAL_ROWS = [
    { student_id: 'u-alice', display_name: 'Alice Aardvark', avatar_id: 'cat', total_correct: 120, total_answered: 150, rank: 1 },
    { student_id: 'smoke-user', display_name: 'Smoke Test', avatar_id: 'penguin', total_correct: 40, total_answered: 60, rank: 2 },
    { student_id: 'u-bob', display_name: 'Bob Beaver', avatar_id: 'dog', total_correct: 10, total_answered: 55, rank: 3 }
  ];
  const CLASS_ROWS = [
    { student_id: 'smoke-user', display_name: 'Smoke Test', avatar_id: 'penguin', total_correct: 40, total_answered: 60, rank: 1 },
    { student_id: 'u-carol', display_name: 'Carol Crane', avatar_id: 'fox', total_correct: 12, total_answered: 30, rank: 2 }
  ];
  const rpcCalls = [];

  await context.addInitScript((cfg) => {
    const profile = {
      id: 'smoke-user', role: 'student', display_name: 'Smoke Test',
      email: 'smoke@example.com', account_settings: {}, avatar_id: 'penguin',
      created_at: new Date().toISOString()
    };
    function ok(data) { return Promise.resolve({ data, error: null }); }
    function builder(table) {
      const b = {
        select() { return b; }, eq() { return b; }, neq() { return b; }, in() { return b; },
        gte() { return b; }, gt() { return b; }, lte() { return b; }, lt() { return b; },
        like() { return b; }, ilike() { return b; }, or() { return b; }, contains() { return b; },
        order() { return b; }, limit() { return b; }, range() { return b; },
        update() { return b; }, upsert() { return b; }, insert() { return b; }, delete() { return b; },
        single() { return table === 'profiles' ? ok(profile) : ok(null); },
        maybeSingle() { return table === 'profiles' ? ok(profile) : ok(null); },
        then(onFulfilled) {
          const rows = (cfg.fromRows && cfg.fromRows[table]) || [];
          return Promise.resolve({ data: rows, error: null }).then(onFulfilled);
        }
      };
      return b;
    }
    const client = {
      auth: {
        getSession: () => Promise.resolve({ data: { session: { user: { id: 'smoke-user', email: 'smoke@example.com' } } }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: () => Promise.resolve({ error: null })
      },
      from: (t) => builder(String(t)),
      rpc: (fn, args) => {
        window.__SMOKE_RPC_CALLS__.push({ fn, args });
        const key = String(fn);
        if (key === 'get_leaderboard_global') return ok(cfg.globalRows);
        if (key === 'get_leaderboard_class') return ok(cfg.classRows);
        return ok([]);
      },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => Promise.resolve()
    };
    window.__SMOKE_RPC_CALLS__ = [];
    // Mark the first-run walkthrough as seen so its modal overlay never
    // intercepts clicks during the test.
    try { window.localStorage.setItem('ihbb_v2_walkthrough_seen_smoke-user', '1'); } catch {}
    window.supabase = { createClient: () => client };
  }, {
    globalRows: GLOBAL_ROWS,
    classRows: CLASS_ROWS,
    fromRows: {
      class_students: [{ class_id: 'c-1', joined_at: '2026-08-01T00:00:00Z' }],
      classes: [{ id: 'c-1', name: 'Class A', code: 'CLSA' }]
    }
  });

  await context.route('**/cdn.jsdelivr.net/**', (route) => route.abort());
  await context.route('**://*.supabase.co/**', (route) => route.abort());

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // --- Deep link straight to the Leaderboard tab ---
  await page.goto(BASE + '/student.html?tab=leaderboard', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.dash-tab.active', { state: 'attached', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500); // let loaders settle

  const activeTab = await page.locator('.dash-tab.active').first().getAttribute('data-tab');
  if (activeTab !== 'leaderboard') fail(`landed on tab "${activeTab}", expected "leaderboard"`);

  // 1) Class board is the only leaderboard panel (Global Top 100 removed)
  const subButtons = page.locator('.leaderboard-sub-tab');
  if (await subButtons.count() !== 0) fail('leaderboard sub-tabs still present, expected none');
  if (await page.locator('#leaderboard-view-global').count() !== 0) fail('global panel still present in DOM');
  if (!(await page.locator('#leaderboard-view-class').isVisible())) fail('class panel is not visible by default');

  // 2) Class board rendered from RPC
  await page.waitForSelector('#leaderboard-list-class .score-entry', { timeout: 10000 }).catch(() => {});
  const classEntries = await page.locator('#leaderboard-list-class .score-entry').count();
  if (classEntries !== CLASS_ROWS.length) fail(`class board shows ${classEntries} rows, expected ${CLASS_ROWS.length}`);
  const classText = await page.locator('#leaderboard-view-class').innerText().catch(() => '');
  if (/failed to load/i.test(classText || '')) fail('class board shows failure message');
  const classRpc = (await page.evaluate(() => window.__SMOKE_RPC_CALLS__)).find(c => c.fn === 'get_leaderboard_class');
  if (!classRpc || classRpc.args?.p_class_id !== 'c-1') fail(`get_leaderboard_class call args wrong: ${JSON.stringify(classRpc)}`);
  const globalRpc = (await page.evaluate(() => window.__SMOKE_RPC_CALLS__)).find(c => c.fn === 'get_leaderboard_global');
  if (globalRpc) fail('get_leaderboard_global was called even though the global board was removed');

  await page.screenshot({ path: path.join(OUT, 'smoke-leaderboard-class-only.png') });

  const blockingErrors = pageErrors.filter((e) => !/supabase|Failed to fetch|mocked/i.test(e));
  if (blockingErrors.length) { console.log('page errors:', blockingErrors.slice(0, 5)); fail('unrelated page errors occurred'); }

  await browser.close();
  server.close();
  if (!process.exitCode) console.log('SMOKE OK: leaderboard shows only the class board, no Global Top 100, class rows render from RPC.');
})().catch((e) => { console.error('SMOKE CRASHED:', e); process.exit(1); });
