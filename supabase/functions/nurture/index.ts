// Five-email follow-up for /scorecard and /kpi-scoreboard leads (copy and timing in lib.ts).
// POST with no query: send whatever is due (pg_cron calls this hourly).
// POST ?u=<email>&t=<token>: unsubscribe (from /unsubscribe or a mail client's one-click button).
// Deploy with verify_jwt off. Sending is a no-op until every required secret is set:
//   RESEND_API_KEY, NURTURE_START (ISO time; only leads after it get emails), NURTURE_FROM,
//   NURTURE_ADDRESS (postal address, required by CAN-SPAM), NURTURE_SECRET (signs unsubscribe links).
// Optional: NURTURE_REPLY_TO, NURTURE_BOOKING_URL, NURTURE_TEST_TO (sends every email there instead).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { CONVERTED_SOURCES, dueSends, type Lead, render, type Send, SITE, SOURCES, unsubToken } from "./lib.ts";

const env = (k: string) => Deno.env.get(k) || "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const FN_URL = `${SUPABASE_URL}/functions/v1/nurture`;
const MAX_PER_RUN = 40;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type" };

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

async function unsubscribe(url: URL) {
  const email = (url.searchParams.get("u") || "").trim().toLowerCase();
  const token = url.searchParams.get("t") || "";
  const secret = env("NURTURE_SECRET");
  if (!email || !secret || token !== (await unsubToken(email, secret))) return json({ ok: false, error: "invalid link" }, 400);
  const res = await rest("nurture_unsubscribes", {
    method: "POST",
    body: JSON.stringify({ email }),
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
  });
  return res.ok ? json({ ok: true, email }) : json({ ok: false, error: await res.text() }, 500);
}

async function run() {
  const missing = ["RESEND_API_KEY", "NURTURE_START", "NURTURE_FROM", "NURTURE_ADDRESS", "NURTURE_SECRET"].filter((k) => !env(k));
  if (missing.length) return json({ ok: true, sent: 0, skipped: `not configured: ${missing.join(", ")}` });
  const start = new Date(env("NURTURE_START"));
  if (isNaN(start.getTime())) return json({ ok: false, error: "NURTURE_START is not a valid date" }, 500);

  const since = start.toISOString();
  const [leadsRes, convRes, sendsRes, unsubRes] = await Promise.all([
    rest(`leads?select=id,name,email,message,source,created_at&source=in.(${SOURCES.join(",")})&created_at=gte.${since}&order=created_at.asc&limit=2000`),
    rest(`leads?select=id,name,email,message,source,created_at&source=in.(${CONVERTED_SOURCES.join(",")})&created_at=gte.${since}&limit=2000`),
    rest("nurture_sends?select=lead_id,step,sent_at&limit=10000"),
    rest("nurture_unsubscribes?select=email&limit=10000"),
  ]);
  for (const r of [leadsRes, convRes, sendsRes, unsubRes]) if (!r.ok) return json({ ok: false, error: await r.text() }, 500);
  const leads: Lead[] = await leadsRes.json();
  const converted: Lead[] = await convRes.json();
  const sends: Send[] = await sendsRes.json();
  const unsubscribed = new Set<string>((await unsubRes.json()).map((u: { email: string }) => u.email));

  const due = dueSends(leads, sends, unsubscribed, converted, new Date(), start).slice(0, MAX_PER_RUN);
  const results: { lead: string; step: number; sent: boolean; error?: string }[] = [];
  for (const { lead, step } of due) {
    // Claim the step first so overlapping runs can never send the same email twice
    const claim = await rest("nurture_sends", {
      method: "POST",
      body: JSON.stringify({ lead_id: lead.id, step }),
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    });
    if (!claim.ok || !(await claim.json()).length) continue;

    const email = lead.email.trim().toLowerCase();
    const q = `u=${encodeURIComponent(email)}&t=${await unsubToken(email, env("NURTURE_SECRET"))}`;
    const msg = render(step, {
      lead,
      bookingUrl: env("NURTURE_BOOKING_URL") || `${SITE}/#teardown`,
      unsubscribeUrl: `${SITE}/unsubscribe/?${q}`,
      address: env("NURTURE_ADDRESS"),
    });
    const send = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env("NURTURE_FROM"),
        to: [env("NURTURE_TEST_TO") || lead.email],
        reply_to: env("NURTURE_REPLY_TO") || undefined,
        subject: (env("NURTURE_TEST_TO") ? `[test → ${lead.email}] ` : "") + msg.subject,
        html: msg.html,
        text: msg.text,
        headers: { "List-Unsubscribe": `<${FN_URL}?${q}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
    });
    if (!send.ok) {
      // Release the claim so the next run retries
      await rest(`nurture_sends?lead_id=eq.${lead.id}&step=eq.${step}`, { method: "DELETE" });
      results.push({ lead: lead.id, step, sent: false, error: await send.text() });
      continue;
    }
    const { id } = await send.json();
    await rest(`nurture_sends?lead_id=eq.${lead.id}&step=eq.${step}`, {
      method: "PATCH",
      body: JSON.stringify({ resend_id: id }),
      headers: { Prefer: "return=minimal" },
    });
    results.push({ lead: lead.id, step, sent: true });
  }
  return json({ ok: results.every((r) => r.sent), due: due.length, results });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const url = new URL(req.url);
  return url.searchParams.has("u") ? unsubscribe(url) : run();
});
