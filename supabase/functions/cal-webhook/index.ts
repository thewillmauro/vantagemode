// Cal.com webhook: turns Free Pipeline Teardown bookings into rows in public.leads.
// Events: BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED (PING is accepted and ignored).
//
// Deploy with verify_jwt off (Cal.com sends no Supabase JWT; see supabase/config.toml).
// Secret: CAL_WEBHOOK_SECRET, the same value as the webhook's secret in Cal.com. Without it
// every request gets 401. Writes use the service role.
//
// Order of checks: size cap (64 KB) on the raw body, HMAC-SHA256 of the raw bytes against
// X-Cal-Signature-256 (constant time), and only then JSON parsing, then createdAt freshness
// (10 minutes). Every write is idempotent on the booking uid, so Cal.com retries are safe.
// Logs carry the event type, the outcome, and a hash of the uid. Never names or emails.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  appendLine,
  type Booking,
  bookingMessage,
  cancelLine,
  EVENTS,
  hashUid,
  isFresh,
  type LeadRow,
  MAX_BODY_BYTES,
  parseBooking,
  raiseTargets,
  rescheduleLine,
  SERVICE,
  verifySignature,
} from "./lib.ts";

const env = (k: string) => Deno.env.get(k) || "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status });
const unauthorized = () => reply(401, { ok: false, error: "unauthorized" });
const log = (event: string, outcome: string, uidHash = "") => console.log(JSON.stringify({ fn: "cal-webhook", event, outcome, uid: uidHash }));

async function readCapped(req: Request): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") || "0");
  if (declared > MAX_BODY_BYTES) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

type Lead = LeadRow & { message: string | null; booking_uid: string | null };
const enc = encodeURIComponent;

async function findByUid(uids: string[]): Promise<Lead | null> {
  if (!uids.length) return null;
  const list = uids.map((u) => `"${u.replace(/["\\]/g, "")}"`).join(",");
  const r = await rest(`leads?select=id,email,status,is_demo,message,booking_uid&booking_uid=in.(${enc(list)})&limit=1`);
  if (!r.ok) throw new Error(`lookup ${r.status}`);
  const rows: Lead[] = await r.json();
  return rows[0] ?? null;
}

async function patch(id: string, body: Record<string, unknown>, extra = "") {
  const r = await rest(`leads?id=eq.${enc(id)}${extra}`, { method: "PATCH", body: JSON.stringify(body), headers: { Prefer: "return=minimal" } });
  if (!r.ok) throw new Error(`patch ${r.status}`);
}

/** Raise other leads with this email from new/contacted to booked. Returns how many moved. */
async function raiseOthers(email: string, excludeId: string | null): Promise<number> {
  const like = email.replace(/[\\%_*]/g, (c) => "\\" + c);
  const r = await rest(`leads?select=id,email,status,is_demo&email=ilike.${enc(like)}&is_demo=is.false&limit=200`);
  if (!r.ok) throw new Error(`raise lookup ${r.status}`);
  const ids = raiseTargets(await r.json(), email, excludeId);
  // The status filter in the PATCH re-checks the rule at write time, so a concurrent change
  // to won/lost/spam is never overwritten.
  for (const id of ids) await patch(id, { status: "booked" }, "&status=in.(new,contacted)");
  return ids.length;
}

async function insertBooking(b: Booking): Promise<string | null> {
  const row = { name: b.name, email: b.email, brand: b.brand, service: SERVICE, source: "booking", status: "booked", booking_uid: b.uid, message: bookingMessage(b) };
  const r = await rest("leads?on_conflict=booking_uid", {
    method: "POST",
    body: JSON.stringify(row),
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
  });
  if (!r.ok) throw new Error(`insert ${r.status}`);
  const rows: { id: string }[] = await r.json();
  return rows[0]?.id ?? null; // null: this uid already exists (replay)
}

async function handle(event: string, b: Booking): Promise<string> {
  if (event === "BOOKING_CREATED") {
    if (await findByUid([b.uid])) return "duplicate";
    const id = await insertBooking(b);
    if (!id) return "duplicate";
    const raised = await raiseOthers(b.email, id);
    return raised ? `created, raised ${raised}` : "created";
  }
  if (event === "BOOKING_RESCHEDULED") {
    if (await findByUid([b.uid])) return "duplicate";
    const prev = await findByUid(b.previousUids);
    if (!prev) {
      const id = await insertBooking(b);
      if (!id) return "duplicate";
      const raised = await raiseOthers(b.email, id);
      return raised ? `created from reschedule, raised ${raised}` : "created from reschedule";
    }
    const msg = appendLine(prev.message, rescheduleLine(b));
    await patch(prev.id, msg ? { booking_uid: b.uid, message: msg } : { booking_uid: b.uid });
    return "rescheduled";
  }
  // BOOKING_CANCELLED: record it on the lead, never delete, never change status.
  const lead = await findByUid([b.uid, ...b.previousUids]);
  if (!lead) return "unknown uid";
  const msg = appendLine(lead.message, cancelLine(b));
  if (!msg) return "duplicate";
  await patch(lead.id, { message: msg });
  return "cancelled";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
  const secret = env("CAL_WEBHOOK_SECRET");
  const raw = await readCapped(req);
  if (raw === null) {
    log("-", "too large");
    return reply(413, { ok: false, error: "too large" });
  }
  if (!secret || !(await verifySignature(raw, req.headers.get("x-cal-signature-256"), secret))) {
    log("-", secret ? "bad signature" : "not configured");
    return unauthorized();
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    log("-", "bad json");
    return reply(400, { ok: false, error: "bad request" });
  }
  const event = typeof body.triggerEvent === "string" ? body.triggerEvent : "";
  if (!isFresh(body.createdAt, Date.now())) {
    log(event || "-", "stale");
    return reply(400, { ok: false, error: "stale" });
  }
  if (!(EVENTS as readonly string[]).includes(event)) {
    log(event || "-", "ignored");
    return reply(200, { ok: true, ignored: true });
  }
  const b = parseBooking(body.payload);
  if (!b) {
    log(event, "unusable payload");
    return reply(400, { ok: false, error: "bad request" });
  }
  const uidHash = await hashUid(b.uid);
  try {
    const outcome = await handle(event, b);
    log(event, outcome, uidHash);
    return reply(200, { ok: true, outcome });
  } catch (e) {
    log(event, `error: ${(e as Error).message}`, uidHash);
    return reply(500, { ok: false, error: "write failed" }); // Cal.com retries; every path is idempotent
  }
});
