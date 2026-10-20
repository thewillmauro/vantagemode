// Browser tests for saving status and notes on /leads.
// Serves THIS checkout's leads/ files to the Chrome installed on the machine (playwright-core,
// no browser download) at a fake origin, and mocks every Supabase request. Nothing reaches the
// real project. The only real network request is the pinned supabase-js file from jsDelivr.
//
//   npm --prefix tests/leads ci && node tests/leads/save.e2e.mjs
//   SHOTS=1 node tests/leads/save.e2e.mjs    also writes 375px screenshots (dark and light) to tests/leads/shots/
//
// Covers: success (card changes only after the server answers, "Saved", "Status set just now"),
// 0 rows back (RLS), a PostgREST error with HTTP status and code, a network failure, a request
// that never answers (15 s timeout and rollback), an auth lock held by another tab, notes
// success and failure, and that failures are logged without lead data.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const ORIGIN = "https://leads.test";
const SUPA = "https://tnkqxniwjomkojufuxlp.supabase.co";
const WILL = "adc80ff8-93f9-4353-8d60-96dd924ea525";

// ── 1. The message text (pure function) ──
const { saveErrorText } = createRequire(import.meta.url)(join(ROOT, "leads", "app.js"));
assert.match(saveErrorText({ timedOut: true }), /^Not confirmed: no response from the server in 15 s\. Refresh to check/);
assert.equal(saveErrorText({ status: 401, code: "PGRST301", message: "JWT expired" }), "Not saved: JWT expired (HTTP 401, code PGRST301).");
assert.equal(saveErrorText({ status: 200, rows: 0 }), "Not saved: the server changed 0 rows (HTTP 200). Sign in again (with your code if you use one).");
assert.equal(saveErrorText({ status: 200, rows: 2 }), "Not saved: expected 1 row back, got 2 (HTTP 200).");
assert.equal(saveErrorText({ message: "Failed to fetch" }), "Not saved: Failed to fetch.");
assert.equal(saveErrorText({}), "Not saved: unknown error.");
for (const o of [{ timedOut: true }, { status: 500, message: "x" }, { rows: 0 }]) assert.ok(!/—/.test(saveErrorText(o)), "no em dashes");
console.log("ok  saveErrorText");

// ── 2. The page, in Chrome ──
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: WILL, role: "authenticated", aud: "authenticated", aal: "aal1", amr: [{ method: "password", timestamp: exp - 3600 }], exp, iat: exp - 3600, session_id: "s1", email: "will@vantagemode.com" })}.sig`;
const user = { id: WILL, aud: "authenticated", role: "authenticated", email: "will@vantagemode.com", app_metadata: {}, user_metadata: {}, factors: [], created_at: "2026-10-01T00:00:00Z" };
const LEAD_EMAIL = "pat.example@x.example.com";
const baseRows = () => [
  { id: "11111111-1111-4111-8111-111111111111", created_at: new Date(Date.now() - 3600e3).toISOString(), name: "Pat Example", email: LEAD_EMAIL, company: null, brand: "Example Co", service: "GTM Scorecard", project_type: null, budget: null, timeline: null, message: "Downloaded the GTM KPI Scoreboard template.", source: "kpi_template", status: "new", notes: null, status_updated_at: null, is_demo: false, booking_uid: null, bot_reasons: null },
];
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*", "content-type": "application/json" };
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

const browser = await chromium.launch({ channel: "chrome", headless: true });

// patch(route, body) decides how each PATCH is answered. Returns a fresh page, signed in.
async function open(patch, { theme = "dark" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  const seen = { patches: [], errors: [], console: [] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  page.on("console", (m) => seen.console.push(m.text()));
  await page.addInitScript((t) => { try { localStorage.setItem("vm-theme", t); } catch (e) {} }, theme);
  await page.route(`${ORIGIN}/**`, (route) => {
    let p = new URL(route.request().url()).pathname;
    if (p.endsWith("/")) p += "index.html";
    try { return route.fulfill({ status: 200, contentType: TYPES[extname(p)] || "application/octet-stream", body: readFileSync(join(ROOT, p)) }); }
    catch { return route.fulfill({ status: 404, body: "" }); }
  });
  await page.route(`${SUPA}/**`, async (route) => {
    const r = route.request(); const u = new URL(r.url());
    if (r.method() === "OPTIONS") return route.fulfill({ status: 200, headers: CORS, body: "" });
    if (u.pathname === "/auth/v1/token") return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user }) });
    if (u.pathname === "/auth/v1/user") return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(user) });
    if (u.pathname.startsWith("/auth/v1/factors")) return route.fulfill({ status: 200, headers: CORS, body: "[]" });
    if (u.pathname === "/rest/v1/leads" && r.method() === "GET") {
      const sel = u.searchParams.get("select").split(",");
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(baseRows().map((x) => Object.fromEntries(sel.map((k) => [k, x[k]])))) });
    }
    if (u.pathname === "/rest/v1/leads" && r.method() === "PATCH") {
      const body = JSON.parse(r.postData());
      seen.patches.push(body);
      return patch(route, body, u.searchParams.get("id").replace("eq.", ""));
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
  await page.goto(`${ORIGIN}/leads/`);
  await page.fill("#siEmail", "will@vantagemode.com");
  await page.fill("#siPassword", "not-a-real-password");
  await page.click("#signInBtn");
  await page.waitForSelector("select.lv-status", { timeout: 15000 });
  return { ctx, page, seen };
}

const ok = (route, body, id) => route.fulfill({ status: 200, headers: CORS, body: JSON.stringify([{ id, ...body, status_updated_at: new Date().toISOString() }]) });
const card = (page) => page.locator("article.lv-card").first();
const msgText = (page) => card(page).locator(".lv-save-msg").textContent();
const waitMsg = (page, re, timeout = 5000) => page.waitForFunction(
  (src) => { const m = document.querySelector("article.lv-card .lv-save-msg"); return m && new RegExp(src).test(m.textContent); }, re.source, { timeout });
const shots = process.env.SHOTS ? join(HERE, "shots") : null;
if (shots) mkdirSync(shots, { recursive: true });

async function check(name, fn) {
  const t0 = Date.now();
  await fn();
  console.log(`ok  ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

await check("status: success only after the server answers, then Saved + stamp", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { ctx, page, seen } = await open(async (route, body, id) => { await gate; return ok(route, body, id); });
  await card(page).locator("select.lv-status").selectOption("contacted");
  await waitMsg(page, /^Saving\.\.\.$/);
  assert.equal(await card(page).getAttribute("data-status"), "new", "card unchanged while saving");
  assert.equal(await card(page).locator("select.lv-status").isDisabled(), true);
  release();
  await waitMsg(page, /^Saved$/);
  assert.equal(await card(page).getAttribute("data-status"), "contacted");
  assert.equal(await card(page).locator(".lv-stamp").textContent(), "Status set just now");
  assert.deepEqual(seen.patches, [{ status: "contacted" }]);
  assert.deepEqual(seen.errors, []);
  if (shots) await card(page).screenshot({ path: join(shots, "saved-dark.png") });
  await ctx.close();
});

await check("status: 0 rows back (RLS) rolls back and says so with HTTP status", async () => {
  const { ctx, page, seen } = await open((route) => route.fulfill({ status: 200, headers: CORS, body: "[]" }));
  await card(page).locator("select.lv-status").selectOption("spam");
  await waitMsg(page, /^Not saved: the server changed 0 rows \(HTTP 200\)/);
  assert.equal(await card(page).locator("select.lv-status").inputValue(), "new");
  assert.equal(await card(page).getAttribute("data-status"), "new");
  assert.equal(await card(page).locator("select.lv-status").isDisabled(), false);
  const log = seen.console.find((l) => l.includes("[leads] save failed"));
  assert.ok(log, "failure logged to the console");
  assert.ok(!seen.console.join("\n").includes(LEAD_EMAIL), "console never gets lead data");
  await ctx.close();
});

await check("status: PostgREST error shows message, HTTP status and code", async () => {
  const { ctx, page } = await open((route) => route.fulfill({ status: 401, headers: CORS, body: JSON.stringify({ code: "PGRST301", message: "JWT expired", details: null, hint: null }) }));
  await card(page).locator("select.lv-status").selectOption("spam");
  await waitMsg(page, /^Not saved: JWT expired \(HTTP 401, code PGRST301\)\.$/);
  assert.equal(await card(page).locator("select.lv-status").inputValue(), "new");
  if (shots) await card(page).screenshot({ path: join(shots, "error-dark.png") });
  await ctx.close();
});

await check("status: network failure rolls back", async () => {
  const { ctx, page } = await open((route) => route.abort("failed"));
  await card(page).locator("select.lv-status").selectOption("spam");
  await waitMsg(page, /^Not saved: /);
  assert.equal(await card(page).locator("select.lv-status").inputValue(), "new");
  await ctx.close();
});

await check("status: no answer for 15 s times out and rolls back", async () => {
  const { ctx, page } = await open(() => new Promise(() => {}));
  await card(page).locator("select.lv-status").selectOption("spam");
  await waitMsg(page, /^Saving\.\.\.$/);
  await waitMsg(page, /^Not confirmed: no response from the server in 15 s\./, 20000);
  assert.equal(await card(page).locator("select.lv-status").inputValue(), "new");
  assert.equal(await card(page).getAttribute("data-status"), "new");
  assert.equal(await card(page).locator("select.lv-status").isDisabled(), false);
  await ctx.close();
});

await check("status: an auth lock held by another tab does not block the save", async () => {
  const { ctx, page, seen } = await open(ok);
  const other = await ctx.newPage();
  await other.route(`${ORIGIN}/**`, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>x</title>" }));
  await other.goto(`${ORIGIN}/other`);
  other.evaluate(() => navigator.locks.request("lock:sb-tnkqxniwjomkojufuxlp-auth-token", () => new Promise(() => {}))).catch(() => {});
  await page.waitForFunction(async () => (await navigator.locks.query()).held.length > 0);
  await card(page).locator("select.lv-status").selectOption("spam");
  await waitMsg(page, /^Saved$/, 20000);
  assert.deepEqual(seen.patches, [{ status: "spam" }]);
  await ctx.close();
});

await check("notes: failure keeps the text and allows a retry; success saves", async () => {
  let fail = true;
  const { ctx, page } = await open((route, body, id) => (fail ? route.fulfill({ status: 200, headers: CORS, body: "[]" }) : ok(route, body, id)));
  const ta = card(page).locator("textarea.lv-notes");
  const btn = card(page).locator("button.lv-save");
  await ta.fill("Called, left a voicemail.");
  await btn.click();
  await waitMsg(page, /^Not saved: the server changed 0 rows/);
  assert.equal(await ta.inputValue(), "Called, left a voicemail.");
  assert.equal(await btn.isDisabled(), false);
  fail = false;
  await btn.click();
  await waitMsg(page, /^Saved$/);
  assert.equal(await btn.isDisabled(), true);
  await ctx.close();
});

if (shots) {
  await check("screenshots: light theme at 375px", async () => {
    const { ctx, page } = await open((route) => route.fulfill({ status: 401, headers: CORS, body: JSON.stringify({ code: "PGRST301", message: "JWT expired" }) }), { theme: "light" });
    await card(page).locator("select.lv-status").selectOption("spam");
    await waitMsg(page, /^Not saved/);
    await card(page).screenshot({ path: join(shots, "error-light.png") });
    await ctx.close();
    const s = await open(ok, { theme: "light" });
    await card(s.page).locator("select.lv-status").selectOption("contacted");
    await waitMsg(s.page, /^Saved$/);
    await card(s.page).screenshot({ path: join(shots, "saved-light.png") });
    const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, "no horizontal scroll at 375px");
    await s.ctx.close();
  });
}

await browser.close();
console.log("PASS save.e2e.mjs");
