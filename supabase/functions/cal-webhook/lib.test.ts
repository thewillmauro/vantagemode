// Run with: node supabase/functions/cal-webhook/lib.test.ts  (Node 23+ runs TypeScript directly)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  appendLine,
  bookingMessage,
  canRaiseToBooked,
  cancelLine,
  formatCallTime,
  hashUid,
  isFresh,
  parseBooking,
  raiseTargets,
  rescheduleLine,
  safeEqual,
  verifySignature,
} from "./lib.ts";

const enc = new TextEncoder();
const secret = "whsec_test_123";
const body = JSON.stringify({ triggerEvent: "BOOKING_CREATED", createdAt: "2026-10-16T14:00:00.000Z", payload: { uid: "abc" } });
const raw = enc.encode(body);
const good = createHmac("sha256", secret).update(raw).digest("hex");

// ── Signature ──
assert.equal(await verifySignature(raw, good, secret), true, "valid signature passes");
assert.equal(await verifySignature(raw, good.toUpperCase(), secret), true, "hex case does not matter");
assert.equal(await verifySignature(raw, "sha256=" + good, secret), true, "sha256= prefix tolerated");
assert.equal(await verifySignature(raw, good, "other-secret"), false, "wrong secret fails");
assert.equal(await verifySignature(enc.encode(body + " "), good, secret), false, "one changed byte fails");
assert.equal(await verifySignature(raw, null, secret), false, "missing header fails");
assert.equal(await verifySignature(raw, "", secret), false, "empty header fails");
assert.equal(await verifySignature(raw, "no-secret-provided", secret), false, "Cal.com's no-secret marker fails");
assert.equal(await verifySignature(raw, good.slice(0, 63), secret), false, "truncated signature fails");
assert.equal(await verifySignature(raw, good, ""), false, "unset secret always fails");
const flipped = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0");
assert.equal(await verifySignature(raw, flipped, secret), false, "last hex digit changed fails");
assert.equal(safeEqual("abcd", "abcd"), true);
assert.equal(safeEqual("abcd", "abce"), false);
assert.equal(safeEqual("abcd", "abc"), false);

// ── Freshness ──
const now = Date.parse("2026-10-16T14:05:00.000Z");
assert.equal(isFresh("2026-10-16T14:00:00.000Z", now), true);
assert.equal(isFresh("2026-10-16T13:54:59.000Z", now), false, "older than 10 minutes");
assert.equal(isFresh("2026-10-16T14:20:00.000Z", now), false, "more than 10 minutes in the future");
assert.equal(isFresh(undefined, now), false);
assert.equal(isFresh("yesterday", now), false);

// ── Status raise rule ──
for (const s of ["new", "contacted"]) assert.equal(canRaiseToBooked(s), true, s);
for (const s of ["booked", "won", "lost", "spam", null, undefined, "NEW"]) assert.equal(canRaiseToBooked(s as string), false, String(s));
const leads = [
  { id: "1", email: "Renata@Tallyforge.com", status: "new" },
  { id: "2", email: "renata@tallyforge.com ", status: "contacted" },
  { id: "3", email: "renata@tallyforge.com", status: "won" },
  { id: "4", email: "renata@tallyforge.com", status: "lost" },
  { id: "5", email: "renata@tallyforge.com", status: "spam" },
  { id: "6", email: "renata@tallyforge.com", status: "new", is_demo: true },
  { id: "7", email: "someone@else.com", status: "new" },
  { id: "8", email: "renata@tallyforge.com", status: "new" },
];
assert.deepEqual(raiseTargets(leads, "renata@tallyforge.com", "8"), ["1", "2"], "only new/contacted, same email, not demo, not the booking itself");
assert.deepEqual(raiseTargets(leads, "nobody@x.com", null), []);

// ── Payload parsing and the message format ──
const payload = {
  uid: "bk_123",
  startTime: "2026-10-19T18:00:00.000Z",
  endTime: "2026-10-19T18:30:00.000Z",
  length: 30,
  attendees: [{ name: "Renata Vasquez", email: "Renata@Tallyforge.example.com", timeZone: "America/Chicago" }],
  responses: {
    name: { label: "Your name", value: "Renata Vasquez" },
    email: { label: "Email address", value: "renata@tallyforge.example.com" },
    company: { label: "Company", value: "Tallyforge" },
    whats_breaking: { label: "What's breaking in your pipeline today?", value: "Lists by hand.\u0007 Nobody trusts HubSpot." },
    location: { label: "Location", value: { optionValue: "", value: "integrations:google:meet" } },
    guests: { label: "Guests", value: [] },
  },
  organizer: { name: "Will", email: "will@vantagemode.com" },
};
const b = parseBooking(payload)!;
assert.equal(b.uid, "bk_123");
assert.equal(b.email, "renata@tallyforge.example.com");
assert.equal(b.name, "Renata Vasquez");
assert.equal(b.brand, "Tallyforge");
assert.equal(b.answer, "Lists by hand. Nobody trusts HubSpot.", "control characters stripped");
assert.equal(formatCallTime(b.startTime, b.minutes), "Mon Oct 19, 2:00 PM ET (30 min)");
assert.equal(bookingMessage(b), "[Cal.com] Free Pipeline Teardown, Mon Oct 19, 2:00 PM ET (30 min)\nWhat's breaking in your pipeline today? → Lists by hand. Nobody trusts HubSpot.");
assert.ok(!JSON.stringify(b).includes("will@vantagemode.com"), "organizer data is not kept");

// Robust answer lookup: odd field slug, plain-string responses, notes fallback, no length
const b2 = parseBooking({ uid: "u2", startTime: "2026-10-20T13:30:00Z", endTime: "2026-10-20T13:50:00Z", attendees: [{ email: "a@b.co" }], responses: { name: "Ann", q1: { label: "Anything we should know?", value: "Need routing" } } })!;
assert.equal(b2.name, "Ann");
assert.equal(b2.answer, "Need routing");
assert.equal(b2.minutes, 20);
assert.equal(bookingMessage(b2), "[Cal.com] Free Pipeline Teardown, Tue Oct 20, 9:30 AM ET (20 min)\nWhat's breaking in your pipeline today? → Need routing");
const b3 = parseBooking({ uid: "u3", responses: { email: { value: "c@d.co" }, name: { value: { firstName: "Cy", lastName: "Dee" } }, notes: { value: "From notes" } } })!;
assert.equal(b3.name, "Cy Dee");
assert.equal(b3.answer, "From notes");
assert.equal(bookingMessage(b3), "[Cal.com] Free Pipeline Teardown, time not given\nWhat's breaking in your pipeline today? → From notes");
const b4 = parseBooking({ uid: "u4", attendees: [{ email: "e@f.co", name: "E" }], startTime: "2026-10-19T18:00:00Z", length: 30 })!;
assert.equal(bookingMessage(b4), "[Cal.com] Free Pipeline Teardown, Mon Oct 19, 2:00 PM ET (30 min)", "no answer, one line");
assert.equal(parseBooking({ attendees: [{ email: "x@y.co" }] }), null, "no uid");
assert.equal(parseBooking({ uid: "u5", attendees: [{ email: "not-an-email" }] }), null, "no usable email");
assert.equal(parseBooking("nope"), null);
const long = parseBooking({ uid: "u6", attendees: [{ email: "x@y.co" }], responses: { q: { label: "What's breaking?", value: "x".repeat(5000) } } })!;
assert.equal(long.answer!.length, 2000, "answer capped");

// Reschedule ids
const r = parseBooking({ uid: "new1", rescheduleUid: "old1", fromReschedule: "old1", attendees: [{ email: "x@y.co" }] })!;
assert.deepEqual(r.previousUids, ["old1"]);

// ── Idempotent message lines ──
const m1 = appendLine(bookingMessage(b), cancelLine(b))!;
assert.ok(m1.endsWith("\n[Cal.com] Cancelled (was Mon Oct 19, 2:00 PM ET (30 min))"));
assert.equal(appendLine(m1, cancelLine(b)), null, "cancel replay is a no-op");
assert.equal(appendLine(null, rescheduleLine(b)), "[Cal.com] Rescheduled to Mon Oct 19, 2:00 PM ET (30 min)");

// ── Log hash ──
assert.match(await hashUid("bk_123"), /^[0-9a-f]{12}$/);
assert.notEqual(await hashUid("bk_123"), await hashUid("bk_124"));

// No em dashes in anything we write
for (const s of [bookingMessage(b), bookingMessage(b2), cancelLine(b), rescheduleLine(b)]) assert.ok(!s.includes("—"), s);

console.log("all cal-webhook tests passed");
