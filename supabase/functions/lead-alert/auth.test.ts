// Run with: node supabase/functions/lead-alert/auth.test.ts  (Node 23+ runs TypeScript directly)
import assert from "node:assert/strict";
import { authorize, SECRET_HEADER, secretMatches } from "./auth.ts";

const URL = "https://example.test/functions/v1/lead-alert";
const req = (method: string, token?: string) =>
  new Request(URL, { method, headers: token === undefined ? {} : { [SECRET_HEADER]: token } });
const status = async (r: Request, secrets: string[]) => (await authorize(r, secrets))?.status ?? 200;

const CUR = "current-secret-0123456789abcdef";
const OLD = "previous-secret-fedcba9876543210";

// secretMatches
assert.equal(await secretMatches(CUR, [CUR]), true);
assert.equal(await secretMatches(CUR, ["", CUR]), true);
assert.equal(await secretMatches(OLD, [CUR, OLD]), true);
assert.equal(await secretMatches("wrong", [CUR, OLD]), false);
assert.equal(await secretMatches(CUR.slice(0, -1), [CUR]), false); // prefix is not a match
assert.equal(await secretMatches(null, [CUR]), false);
assert.equal(await secretMatches("", [CUR]), false);
assert.equal(await secretMatches("", ["", ""]), false); // empty never matches empty config

// authorize: happy path, current and previous (rotation)
assert.equal(await status(req("POST", CUR), [CUR, ""]), 200);
assert.equal(await status(req("POST", OLD), [CUR, OLD]), 200);
assert.equal(await status(req("POST", OLD), [CUR, ""]), 401); // previous removed after rotation

// rejections
assert.equal(await status(req("POST"), [CUR, ""]), 401); // no header
assert.equal(await status(req("POST", ""), [CUR, ""]), 401); // empty header
assert.equal(await status(req("POST", "wrong"), [CUR, ""]), 401);
assert.equal(await status(req("POST", CUR.toUpperCase()), [CUR, ""]), 401);
assert.equal(await status(req("GET", CUR), [CUR, ""]), 405); // GET used to run the full sweep
assert.equal(await status(req("PUT", CUR), [CUR, ""]), 405);

// fail closed when no secret is configured, even with a header
assert.equal(await status(req("POST", CUR), ["", ""]), 500);
assert.equal(await status(req("POST"), ["", ""]), 500);
const body = await (await authorize(req("POST", "x"), [CUR, ""]))!.json();
assert.deepEqual(body, { ok: false, error: "unauthorized" }); // no detail leaked

// header name is case-insensitive (pg_net and curl may differ in case)
const mixed = new Request(URL, { method: "POST", headers: { "X-Lead-Alert-Secret": CUR } });
assert.equal(await status(mixed, [CUR, ""]), 200);

console.log("lead-alert auth tests passed");
