// Shared-secret check for lead-alert. Runtime-agnostic (Request, Response and
// crypto.subtle only) so `node supabase/functions/lead-alert/auth.test.ts` runs it.
// secretMatches is copied from veroxa-gtm's supabase/functions/_shared/http.ts, the
// check used by its clay-callback, smartlead-webhook and inbound functions; the
// header-plus-_PREVIOUS shape follows inbound (also called by a pg_net trigger).

export const SECRET_HEADER = "x-lead-alert-secret";

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** Constant-time comparison: compares fixed-length digests, never early-exits. */
export async function secretMatches(provided: string | null, accepted: string[]): Promise<boolean> {
  if (!provided) return false;
  const p = await sha256(provided);
  let ok = false;
  for (const secret of accepted) {
    if (!secret) continue;
    const s = await sha256(secret);
    let diff = 0;
    for (let i = 0; i < s.length; i++) diff |= s[i]! ^ p[i]!;
    ok = ok || diff === 0;
  }
  return ok;
}

/**
 * Returns a rejection Response, or null when the request may proceed.
 * Runs before anything else in the function, so an unauthenticated caller
 * never reaches the leads query or Resend, and learns nothing about config.
 * `secrets` is [LEAD_ALERT_SECRET, LEAD_ALERT_SECRET_PREVIOUS]; empty entries are ignored.
 */
export async function authorize(req: Request, secrets: string[]): Promise<Response | null> {
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  if (secrets.filter(Boolean).length === 0) {
    // Fail closed: with no secret configured, nobody gets in.
    console.error("lead-alert: LEAD_ALERT_SECRET is not set; rejecting all requests");
    return json(500, { ok: false, error: "not_configured" });
  }
  if (!(await secretMatches(req.headers.get(SECRET_HEADER), secrets))) {
    console.warn("lead-alert: unauthorized request");
    return json(401, { ok: false, error: "unauthorized" });
  }
  return null;
}
