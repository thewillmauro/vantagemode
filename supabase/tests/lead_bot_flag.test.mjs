// Tests for the lead bot flag (supabase/migrations/20261019120000_leads_bot_flag.sql).
// Runs the real migration files in PGlite (Postgres compiled to WebAssembly, in memory).
// Nothing here connects to the Supabase project.
//
//   npm --prefix supabase/tests ci && node supabase/tests/lead_bot_flag.test.mjs
//
// The bot stand-ins below are SYNTHETIC lookalikes of the two 2026-10-15 bot rows (same
// shape: empty or mixed-case-noise name, short made-up company, a Gmail address with a dot
// between almost every character). They are not the real values.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const MIG = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
// The cron schedule needs pg_cron, which PGlite does not have; nothing here depends on it.
const SKIP = new Set(["20261015031027_nurture.sql"]);

const db = await PGlite.create();

// Stand-ins for what Supabase (and the 2026-10-07 lead_alerts change outside migration
// history) provide in production.
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  create schema net;
  create table net.calls (id serial, body jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int)
    returns bigint language sql as $$ insert into net.calls (body) values (body) returning id::bigint $$;
  create schema private;
  -- Placeholder for the lead_alerts version; 20261018000000 replaces the body.
  create function private.notify_new_lead() returns trigger language plpgsql security definer
    as $$ begin perform net.http_post('x', jsonb_build_object('lead_id', new.id), '{}'::jsonb, 1); return new; end $$;
`);

const files = readdirSync(MIG).filter((f) => f.endsWith(".sql") && !SKIP.has(f)).sort();
for (const f of files) {
  await db.exec(readFileSync(join(MIG, f), "utf8"));
  if (f.startsWith("20260331123349")) {
    // lead_alerts (applied outside history) added alerted_at.
    await db.exec("alter table public.leads add column if not exists alerted_at timestamptz;");
  }
}
assert.ok(files.includes("20261019120000_leads_bot_flag.sql"), "bot flag migration loaded");
console.log(`loaded ${files.length} migrations`);

// ── 1. The rules, input by input ──

const reasons = async (name, company, email) =>
  (await db.query("select private.lead_bot_reasons($1, $2, $3) as r", [name, company, email])).rows[0].r;

// Synthetic lookalikes of the two confirmed bots.
const BOT_EMAIL = "q.w.ab.ezo.k.3.81@gmail.com";
const BOT_A = { name: "", brand: null, email: BOT_EMAIL, source: "sdr_calculator" };
const BOT_B = { name: "PLxRtQmVbNkaWzYuJ tGHsDkWqLpZXnvbRTyqowE", brand: "Uvexqa LLC", email: BOT_EMAIL, source: "kpi_template" };

assert.deepEqual(await reasons(BOT_A.name, BOT_A.brand, BOT_A.email), ["gmail_dots"]);
const rb = await reasons(BOT_B.name, BOT_B.brand, BOT_B.email);
assert.ok(rb.includes("name_mixed_case"), `bot B mixed case: ${rb}`);
assert.ok(rb.includes("gmail_dots"), `bot B gmail dots: ${rb}`);

// Each rule on its own.
assert.deepEqual(await reasons("Ada aBcDeFgH", null, "ada@x.com"), ["name_mixed_case"]);
assert.deepEqual(await reasons("qwrtzpk lane", null, "ada@x.com"), ["name_consonant_run"]);
assert.deepEqual(await reasons("Ada", "aXeBiCoDu", "ada@x.com"), ["company_mixed_case"]);
assert.deepEqual(await reasons("Ada", "Bcdfgh Labs", "ada@x.com"), ["company_consonant_run"]);
assert.deepEqual(await reasons("Ada", null, "a.b.c.d.e@gmail.com"), ["gmail_dots"]);
assert.deepEqual(await reasons("Ada", null, "A.B.C.D.E@GoogleMail.com"), ["gmail_dots"]);
assert.deepEqual(await reasons("Ada", null, "  a.b.c.d.e@gmail.com  "), ["gmail_dots"]);
// Boundaries: 3 dots pass, 4 flag; 5 consonants pass, 6 flag; 2 case flips pass, 3 flag.
assert.deepEqual(await reasons("Ada", null, "a.b.c.dee@gmail.com"), []);
assert.deepEqual(await reasons("Ada", null, "a.b.c.d.ee@gmail.com"), ["gmail_dots"]);
assert.deepEqual(await reasons("Angstrom", null, "ada@x.com"), []);
assert.deepEqual(await reasons("Ada bcdfgha", null, "ada@x.com"), ["name_consonant_run"]);
assert.deepEqual(await reasons("aBcDe", null, "ada@x.com"), []);
assert.deepEqual(await reasons("aBcDeF", null, "ada@x.com"), ["name_mixed_case"]);
// Dots after a +tag do not count; the +tag itself is ignored.
assert.deepEqual(await reasons("Ada", null, "first.last+a.b.c.d@gmail.com"), []);
// Case flips are counted per word, not across the whole field.
assert.deepEqual(await reasons("DeVon McKinsey LaToya", null, "ada@x.com"), []);
// Nulls and empties.
assert.deepEqual(await reasons(null, null, null), []);
assert.deepEqual(await reasons("", "", ""), []);

// Normal inputs must pass.
const NAMES = [
  "Al", "Xi", "Bo", "Mary-Jane O'Neil", "Nguyen", "Siobhan", "Zbigniew", "Ngozi", "Krzysztof",
  "Thi Thu Nguyen", "Siobhán Ní Bhriain", "Zbigniew Brzęczyszczykiewicz", "Ngozi Okonjo-Iweala",
  "Krzysztof Szczepański", "José Núñez", "Søren Kierkegaard", "Schmidt", "Fitzgerald",
  "DeVon", "LaToya", "MacKenzie", "D'Angelo", "Jean-Luc Picard", "Ada Lovelace", "ADA LOVELACE",
];
const COMPANIES = [
  "IBM", "HCL", "SDRx", "eBay", "iRobot", "HubSpot", "McKinsey", "McKinsey & Company",
  "Salesforce", "SalesForceIQ", "ZoomInfo", "GitHub", "PwC", "AT&T", "3M", "Acme, Inc.",
  "Vantage Mode", "Northwind LLC", "Strategy&", "KPMG LLP",
];
const EMAILS = [
  "first.last@gmail.com", "j.smith@gmail.com", "j.r.smith@gmail.com", "mary.jane.oneil@gmail.com",
  "first.last+leads@gmail.com", "ada@gmail.com", "a.b.c.d.e@company.co.uk",
  "mary.jane.o.neil@outlook.com", "first.m.last.jr@example.org", "ada@sub.domain.example.com",
];
for (const n of NAMES) assert.deepEqual(await reasons(n, null, "ada@x.com"), [], `name should pass: ${n}`);
for (const c of COMPANIES) assert.deepEqual(await reasons("Ada", c, "ada@x.com"), [], `company should pass: ${c}`);
for (const e of EMAILS) assert.deepEqual(await reasons("Ada", null, e), [], `email should pass: ${e}`);
console.log(`rules: ${NAMES.length} names, ${COMPANIES.length} companies, ${EMAILS.length} emails pass; bots and boundaries flag`);

// ── 2. The triggers, end to end ──

const asAnon = async (lead) => {
  await db.exec("set role anon");
  try {
    await db.query(
      "insert into public.leads (name, email, brand, message, source, hp) values ($1, $2, $3, $4, $5, $6)",
      [lead.name, lead.email, lead.brand ?? null, lead.message ?? null, lead.source, lead.hp ?? null],
    );
  } finally {
    await db.exec("reset role");
  }
};
const row = async (email, source) =>
  (await db.query("select id, status, bot_reasons, is_demo from public.leads where email = $1 and source = $2", [email, source])).rows;
const alertCalls = async () => (await db.query("select count(*)::int as n from net.calls")).rows[0].n;

// A normal lead: status new, no reasons, alert fires.
let calls = await alertCalls();
await asAnon({ name: "Mary-Jane O'Neil", email: "mary.jane@gmail.com", brand: "HubSpot", source: "kpi_template" });
let r = await row("mary.jane@gmail.com", "kpi_template");
assert.equal(r.length, 1);
assert.equal(r[0].status, "new");
assert.equal(r[0].bot_reasons, null);
assert.equal(await alertCalls(), calls + 1, "normal lead alerts");

// The two bot lookalikes: kept, status spam, reasons recorded, no alert.
calls = await alertCalls();
await asAnon(BOT_A);
await asAnon(BOT_B);
const [a] = await row(BOT_EMAIL, "sdr_calculator");
const [b] = await row(BOT_EMAIL, "kpi_template");
assert.equal(a.status, "spam");
assert.deepEqual(a.bot_reasons, ["gmail_dots"]);
assert.equal(b.status, "spam");
assert.ok(b.bot_reasons.includes("name_mixed_case") && b.bot_reasons.includes("gmail_dots"));
assert.equal(await alertCalls(), calls, "flagged rows do not alert");

// Honeypot still drops the row before the bot rules run.
await asAnon({ name: "Ada", email: "hp@x.com", source: "contact", hp: "http://spam" });
assert.equal((await row("hp@x.com", "contact")).length, 0);

// Anon cannot write bot_reasons or pick its own status.
await db.exec("set role anon");
await assert.rejects(db.query("insert into public.leads (name, email, source, bot_reasons) values ('Ada', 'x@x.com', 'contact', '{}')"), /permission denied/);
await db.exec("reset role");

// Service-role rows: bookings and demo rows are never flagged.
await db.query("insert into public.leads (name, email, source, status) values ('Ada', 'a.b.c.d.e@gmail.com', 'booking', 'booked')");
assert.deepEqual((await row("a.b.c.d.e@gmail.com", "booking")).map((x) => [x.status, x.bot_reasons]), [["booked", null]]);
await db.query("insert into public.leads (name, email, source, is_demo, alerted_at) values ('aBcDeFgH', 'demo@x.example.com', 'contact', true, now())");
assert.deepEqual((await row("demo@x.example.com", "contact")).map((x) => [x.status, x.bot_reasons]), [["new", null]]);
// A service-role insert with another status keeps it, but the reasons are still recorded.
await db.query("insert into public.leads (name, email, source, status) values ('aBcDeFgH', 'svc@x.com', 'contact', 'contacted')");
assert.deepEqual((await row("svc@x.com", "contact")).map((x) => [x.status, x.bot_reasons]), [["contacted", ["name_mixed_case"]]]);

// Recovering a false positive: Will sets the status back. The change is logged and the
// reasons stay on the row as a record of why it was flagged.
await db.query("update public.leads set status = 'new' where id = $1", [a.id]);
const [a2] = await row(BOT_EMAIL, "sdr_calculator");
assert.equal(a2.status, "new");
assert.deepEqual(a2.bot_reasons, ["gmail_dots"]);
const hist = (await db.query("select old_status, new_status from public.lead_status_history where lead_id = $1", [a.id])).rows;
assert.deepEqual(hist, [{ old_status: "spam", new_status: "new" }]);

console.log("triggers: normal lead alerts; bot lookalikes kept as spam with reasons and no alert; honeypot, bookings, demo, recovery OK");
console.log("PASS lead_bot_flag.test.mjs");
