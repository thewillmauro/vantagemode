// Run with: node supabase/functions/nurture/lib.test.ts  (Node 23+ runs TypeScript directly)
import assert from "node:assert/strict";
import { dueSends, type Lead, parseScorecard, render, unsubToken } from "./lib.ts";

const msg = `GTM Readiness Scorecard: 50/100 (Partly systemized)
Data 50 · AI Agents 17 · RevOps 83
Weakest: AI Agents
Top gaps: Research eats selling time; Outreach reads like a template; Leads arrive without context
Report link: https://www.vantagemode.com/scorecard?r=100012300113322

Answers:
C1 How many people sell today? → 1 to 3`;

const sc = parseScorecard(msg)!;
assert.equal(sc.overall, 50);
assert.equal(sc.ai, 17);
assert.equal(sc.weakest, "AI Agents");
assert.equal(sc.gaps.length, 3);
assert.equal(sc.reportUrl, "https://www.vantagemode.com/scorecard?r=100012300113322");
assert.equal(parseScorecard("Downloaded the template."), null);

const start = new Date("2026-10-14T00:00:00Z");
const day = (d: number, h = 0) => new Date(start.getTime() + d * 86400000 + h * 3600000);
const lead = (id: string, email: string, source: string, at: Date, message: string | null = null): Lead =>
  ({ id, name: "Ada Lovelace", email, message, source, created_at: at.toISOString() });

const a = lead("a", "ada@x.com", "scorecard", day(0, 1), msg);
const aDupe = lead("a2", "ADA@x.com", "kpi_template", day(1));
const b = lead("b", "bob@x.com", "kpi_template", day(0, 2));
const old = lead("o", "old@x.com", "scorecard", day(-3), msg);
const c = lead("c", "cat@x.com", "kpi_template", day(0, 3));
const cConverted = lead("c2", "cat@x.com", "teardown", day(1));
const leads = [a, aDupe, b, old, c];

// Day 0: everyone after the start gets email 1, once per address; old leads and converted leads are skipped
let due = dueSends(leads, [], new Set(), [cConverted], day(0, 5), start);
assert.deepEqual(due.map((d) => [d.lead.id, d.step]), [["a", 0], ["b", 0]]);

// Day 1: nothing due yet (email 2 is day 2)
const sends = [{ lead_id: "a", step: 0, sent_at: day(0, 5).toISOString() }, { lead_id: "b", step: 0, sent_at: day(0, 5).toISOString() }];
assert.equal(dueSends(leads, sends, new Set(), [cConverted], day(1, 5), start).length, 0);

// Day 2: email 2 due; unsubscribed bob is skipped
due = dueSends(leads, sends, new Set(["bob@x.com"]), [cConverted], day(2, 2), start);
assert.deepEqual(due.map((d) => [d.lead.id, d.step]), [["a", 1]]);

// Catch-up after downtime: at day 20 with only email 1 sent, send email 2 now, and not email 3 within 20 hours
due = dueSends(leads, sends, new Set(), [cConverted], day(20), start);
assert.deepEqual(due.map((d) => d.step), [1, 1]);
const later = [...sends, { lead_id: "a", step: 1, sent_at: day(20).toISOString() }];
assert.equal(dueSends([a], later, new Set(), [], day(20, 10), start).length, 0);
assert.equal(dueSends([a], later, new Set(), [], day(20, 21), start)[0].step, 2);

// Finished sequences stay finished
const all = [0, 1, 2, 3, 4].map((s) => ({ lead_id: "a", step: s, sent_at: day(s * 3).toISOString() }));
assert.equal(dueSends([a], all, new Set(), [], day(60), start).length, 0);

// Tokens are stable, case-insensitive, and differ by secret
assert.equal(await unsubToken("Ada@X.com", "s1"), await unsubToken("ada@x.com", "s1"));
assert.notEqual(await unsubToken("ada@x.com", "s1"), await unsubToken("ada@x.com", "s2"));

// Every email renders for both sources, with no em dashes and the unsubscribe + address footer
const ctx = (l: Lead) => ({ lead: l, bookingUrl: "https://www.vantagemode.com/#teardown", unsubscribeUrl: "https://www.vantagemode.com/unsubscribe/?u=x&t=y", address: "123 Example St, City, ST 00000" });
for (const l of [a, b, lead("z", "z@x.com", "scorecard", day(0), "garbled")]) {
  for (let s = 0; s < 5; s++) {
    const m = render(s, ctx(l));
    assert.ok(!/—/.test(m.subject + m.text + m.html), `em dash in ${l.source} step ${s}`);
    assert.ok(m.text.includes("Unsubscribe: https://www.vantagemode.com/unsubscribe/") && m.html.includes("123 Example St"));
    assert.ok(!/undefined|NaN|\[object/.test(m.text), `bad interpolation in ${l.source} step ${s}: ${m.text}`);
  }
}
console.log("all nurture tests passed");

if (process.argv[2]) {
  const { writeFileSync } = await import("node:fs");
  const out: string[] = [];
  for (const l of [a, b]) for (let s = 0; s < 5; s++) {
    const m = render(s, ctx(l));
    out.push(`<h3 style="font-family:sans-serif;background:#eee;padding:8px">${l.source} · email ${s + 1} · day ${[0, 2, 5, 9, 14][s]} · Subject: ${m.subject}</h3>${m.html}`);
  }
  writeFileSync(process.argv[2], `<!doctype html><meta charset="utf-8"><body style="background:#fff">${out.join("<hr>")}`);
  console.log("wrote preview to", process.argv[2]);
}
