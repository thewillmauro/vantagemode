// Pure logic for the Cal.com webhook: signature check, freshness, payload parsing, the lead
// message format, and the status-raise rule. No Deno or network APIs here, so it runs under
// Node for tests:  node supabase/functions/cal-webhook/lib.test.ts

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_AGE_MS = 10 * 60 * 1000;
export const SERVICE = "Free Pipeline Teardown";
export const DEFAULT_QUESTION = "What's breaking in your pipeline today?";
export const EVENTS = ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"] as const;
const LIMITS = { name: 200, email: 320, brand: 300, answer: 2000, question: 200 };

const enc = new TextEncoder();

async function hmacHex(secret: string, data: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare of two equal-length strings (the length itself is not secret). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * X-Cal-Signature-256 is the hex HMAC-SHA256 of the raw request body, keyed with the
 * webhook secret. Compared on the raw bytes, before any parsing.
 */
export async function verifySignature(raw: Uint8Array, header: string | null, secret: string): Promise<boolean> {
  if (!secret || !header) return false;
  const given = header.trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  return safeEqual(await hmacHex(secret, raw), given);
}

/** createdAt must be within 10 minutes of now (either direction), or the event is a replay. */
export function isFresh(createdAt: unknown, now: number): boolean {
  if (typeof createdAt !== "string") return false;
  const t = Date.parse(createdAt);
  return !isNaN(t) && Math.abs(now - t) <= MAX_AGE_MS;
}

/** Hash for logs, so a booking can be traced without logging the raw uid. */
export async function hashUid(uid: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(uid)));
  return Array.from(d.slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type Booking = {
  uid: string;
  previousUids: string[];
  name: string;
  email: string;
  brand: string | null;
  startTime: string | null;
  minutes: number | null;
  question: string;
  answer: string | null;
};

const SYSTEM_FIELDS = new Set(["name", "email", "location", "guests", "rescheduleReason", "attendeePhoneNumber", "smsReminderNumber", "notes", "title"]);
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
// Strip control characters other than newline and tab; untrusted text still renders as text only.
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();

function responseValue(v: unknown): string {
  const inner = isObj(v) && "value" in v ? v.value : v;
  if (typeof inner === "string") return clean(inner);
  if (isObj(inner)) return clean([str(inner.firstName), str(inner.lastName)].filter(Boolean).join(" "));
  return "";
}
function responseLabel(key: string, v: unknown): string {
  return isObj(v) && typeof v.label === "string" ? clean(v.label) : key;
}

/** Pulls only the fields we keep from a Cal.com webhook payload. Returns null if unusable. */
export function parseBooking(payload: unknown): Booking | null {
  if (!isObj(payload)) return null;
  const uid = str(payload.uid);
  if (!uid || uid.length > 200) return null;
  const responses = isObj(payload.responses) ? payload.responses : {};
  const attendee = Array.isArray(payload.attendees) && isObj(payload.attendees[0]) ? payload.attendees[0] : {};

  const email = clean(str(attendee.email) || responseValue(responses.email)).toLowerCase();
  if (!email || !email.includes("@") || email.length > LIMITS.email) return null;
  const name = clip(clean(str(attendee.name) || responseValue(responses.name)), LIMITS.name);

  // The booking question: prefer a field whose label mentions the pipeline, then any other
  // custom text field, then Cal.com's standard notes field.
  const custom = Object.entries(responses)
    .filter(([k]) => !SYSTEM_FIELDS.has(k))
    .map(([k, v]) => ({ key: k, label: responseLabel(k, v), value: responseValue(v) }))
    .filter((f) => f.value);
  const brandField = custom.find((f) => /company|brand|organi[sz]ation|business/i.test(f.key + " " + f.label));
  const answerField =
    custom.find((f) => f !== brandField && /break|pipeline/i.test(f.label)) ||
    custom.find((f) => f !== brandField && !/phone|linkedin|url|website/i.test(f.key + " " + f.label));
  let question = DEFAULT_QUESTION;
  let answer = "";
  if (answerField) {
    answer = answerField.value;
    if (/break|pipeline/i.test(answerField.label)) question = answerField.label;
  } else {
    answer = responseValue(responses.notes) || clean(str(payload.additionalNotes));
  }

  const start = str(payload.startTime);
  const end = str(payload.endTime);
  let minutes = typeof payload.length === "number" && payload.length > 0 ? payload.length : null;
  if (!minutes && start && end) {
    const m = Math.round((Date.parse(end) - Date.parse(start)) / 60000);
    if (m > 0 && m < 24 * 60) minutes = m;
  }
  const previousUids = [payload.rescheduleUid, payload.fromReschedule, isObj(payload.originalRescheduledBooking) ? payload.originalRescheduledBooking.uid : null]
    .map(str)
    .filter((u) => u && u !== uid && u.length <= 200);

  return {
    uid,
    previousUids: [...new Set(previousUids)],
    name,
    email,
    brand: brandField ? clip(brandField.value, LIMITS.brand) : null,
    startTime: start && !isNaN(Date.parse(start)) ? start : null,
    minutes,
    question: clip(question, LIMITS.question),
    answer: answer ? clip(answer, LIMITS.answer) : null,
  };
}

/** "Mon Oct 19, 2:00 PM ET (30 min)". Always Eastern, since that is Will's calendar. */
export function formatCallTime(startIso: string | null, minutes: number | null): string {
  if (!startIso) return "time not given";
  const d = new Date(startIso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.month} ${parts.day}, ${parts.hour}:${parts.minute} ${parts.dayPeriod} ET` + (minutes ? ` (${minutes} min)` : "");
}

export function bookingMessage(b: Booking): string {
  const head = `[Cal.com] ${SERVICE}, ${formatCallTime(b.startTime, b.minutes)}`;
  return b.answer ? `${head}\n${b.question} → ${b.answer}` : head;
}
export const rescheduleLine = (b: Booking) => `[Cal.com] Rescheduled to ${formatCallTime(b.startTime, b.minutes)}`;
export const cancelLine = (b: Booking) => `[Cal.com] Cancelled (was ${formatCallTime(b.startTime, b.minutes)})`;

/** Appends a line once; returns null when it is already there (idempotent replays). */
export function appendLine(message: string | null, line: string): string | null {
  const m = message || "";
  if (m.split("\n").includes(line)) return null;
  return (m ? m + "\n" : "") + line;
}

/** A booking moves an existing lead to "booked" only from new or contacted. Never won, lost, spam, or booked. */
export function canRaiseToBooked(status: string | null | undefined): boolean {
  return status === "new" || status === "contacted";
}

export type LeadRow = { id: string; email: string; status: string | null; is_demo?: boolean };

/** Other real leads with the same email (case-insensitive) whose status a booking may raise. */
export function raiseTargets(leads: LeadRow[], email: string, excludeId: string | null): string[] {
  const e = email.trim().toLowerCase();
  return leads
    .filter((l) => l.id !== excludeId && l.is_demo !== true && l.email.trim().toLowerCase() === e && canRaiseToBooked(l.status))
    .map((l) => l.id);
}
