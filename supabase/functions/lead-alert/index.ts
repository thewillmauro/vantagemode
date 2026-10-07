// Emails a new-lead alert for every lead that has not been alerted yet.
// Called by the leads insert trigger and by the daily keep-alive workflow.
// It never trusts the request body: it reads unalerted leads with the service
// role, so an outside caller can at most trigger one alert per existing lead.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ALERT_TO = Deno.env.get("ALERT_TO") ?? "thewillmauro@gmail.com";
const ALERT_FROM = Deno.env.get("ALERT_FROM") ?? "Vantage Mode Leads <onboarding@resend.dev>";

type Lead = {
  id: string;
  name: string | null;
  email: string;
  brand: string | null;
  company: string | null;
  service: string | null;
  timeline: string | null;
  budget: string | null;
  message: string | null;
  source: string | null;
  created_at: string;
};

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function render(lead: Lead) {
  const rows: [string, string | null][] = [
    ["Name", lead.name],
    ["Email", lead.email],
    ["Company", lead.brand || lead.company],
    ["Interested in", lead.service],
    ["Timeline", lead.timeline],
    ["Budget", lead.budget],
    ["Source", lead.source],
    ["Received", new Date(lead.created_at).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET"],
  ];
  const table = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:6px 16px 6px 0;color:#6b6458;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0">${esc(v)}</td></tr>`)
    .join("");
  const message = lead.message
    ? `<p style="margin:20px 0 6px;color:#6b6458">Message</p><div style="white-space:pre-wrap;padding:12px 14px;background:#f5f0e8;border-left:3px solid #c9a84c">${esc(lead.message)}</div>`
    : "";
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#080808;max-width:560px">
<p style="margin:0 0 16px;font-size:16px"><strong>New lead from vantagemode.com</strong></p>
<table style="border-collapse:collapse">${table}</table>${message}
<p style="margin:24px 0 0;color:#6b6458;font-size:12px">Reply to this email to answer ${esc(lead.name || lead.email)} directly.</p></div>`;
  const text = rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n") + (lead.message ? `\n\nMessage:\n${lead.message}` : "");
  const who = lead.name || lead.email;
  const subject = `New lead: ${lead.service || "Inquiry"} from ${who}`;
  return { html, text, subject };
}

Deno.serve(async () => {
  if (!RESEND_API_KEY) {
    return Response.json({ ok: false, error: "RESEND_API_KEY is not set" }, { status: 500 });
  }

  const res = await rest("leads?alerted_at=is.null&order=created_at.asc&limit=20&select=*");
  if (!res.ok) return Response.json({ ok: false, error: await res.text() }, { status: 500 });
  const leads: Lead[] = await res.json();

  const results: { id: string; sent: boolean; error?: string }[] = [];
  for (const lead of leads) {
    const { html, text, subject } = render(lead);
    const send = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: ALERT_FROM, to: [ALERT_TO], reply_to: lead.email, subject, html, text }),
    });
    if (!send.ok) {
      results.push({ id: lead.id, sent: false, error: await send.text() });
      continue;
    }
    await rest(`leads?id=eq.${lead.id}`, {
      method: "PATCH",
      body: JSON.stringify({ alerted_at: new Date().toISOString() }),
      headers: { Prefer: "return=minimal" },
    });
    results.push({ id: lead.id, sent: true });
  }

  return Response.json({ ok: results.every((r) => r.sent), pending: leads.length, results });
});
