// Pure logic for the follow-up sequence: who is due for which email, and what it says.
// No Deno or network APIs here, so it runs under Node for tests:
//   node supabase/functions/nurture/lib.test.ts

export const SITE = "https://www.vantagemode.com";
export const SOURCES = ["scorecard", "kpi_template"] as const;
// A lead from any of these has already reached out, so the sequence stops for that email
export const CONVERTED_SOURCES = ["teardown", "project_wizard", "contact_form", "sow_form"];
// Days after signup for each of the five emails
export const OFFSETS_DAYS = [0, 2, 5, 9, 14];
const MIN_GAP_MS = 20 * 3600 * 1000; // never two emails within ~a day, even when catching up after downtime

export type Lead = {
  id: string;
  name: string | null;
  email: string;
  message: string | null;
  source: string | null;
  created_at: string;
};
export type Send = { lead_id: string; step: number; sent_at: string };

export type Scorecard = {
  overall: number;
  band: string;
  data: number;
  ai: number;
  revops: number;
  weakest: string;
  gaps: string[];
  reportUrl: string;
};

/** Reads the summary lines the /scorecard page writes into leads.message. */
export function parseScorecard(message: string | null): Scorecard | null {
  if (!message) return null;
  const head = message.match(/Scorecard: (\d+)\/100 \(([^)]+)\)/);
  const pillars = message.match(/Data (\d+) · AI Agents (\d+) · RevOps (\d+)/);
  const weakest = message.match(/^Weakest: (.+)$/m);
  const gaps = message.match(/^Top gaps: (.+)$/m);
  const link = message.match(/^Report link: (https:\/\/\S+)$/m);
  if (!head || !pillars || !weakest) return null;
  return {
    overall: Number(head[1]),
    band: head[2],
    data: Number(pillars[1]),
    ai: Number(pillars[2]),
    revops: Number(pillars[3]),
    weakest: weakest[1].trim(),
    gaps: gaps && gaps[1].trim() !== "none" ? gaps[1].split("; ").map((g) => g.trim()) : [],
    reportUrl: link ? link[1] : `${SITE}/scorecard`,
  };
}

/**
 * Picks the next email for each lead that is due now.
 * One sequence per email address (the earliest qualifying lead), skipping
 * unsubscribed addresses and anyone who later reached out through another form.
 */
export function dueSends(
  leads: Lead[],
  sends: Send[],
  unsubscribed: Set<string>,
  converted: Lead[],
  now: Date,
  start: Date,
): { lead: Lead; step: number }[] {
  const seen = new Set<string>();
  const out: { lead: Lead; step: number }[] = [];
  const sorted = [...leads]
    .filter((l) => SOURCES.includes(l.source as typeof SOURCES[number]) && new Date(l.created_at) >= start)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const lead of sorted) {
    const email = lead.email.trim().toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    if (unsubscribed.has(email)) continue;
    if (converted.some((c) => c.email.trim().toLowerCase() === email && c.created_at > lead.created_at)) continue;
    const mine = sends.filter((s) => s.lead_id === lead.id);
    const step = mine.length ? Math.max(...mine.map((s) => s.step)) + 1 : 0;
    if (step >= OFFSETS_DAYS.length) continue;
    const due = new Date(lead.created_at).getTime() + OFFSETS_DAYS[step] * 86400000;
    if (now.getTime() < due) continue;
    const last = mine.length ? Math.max(...mine.map((s) => new Date(s.sent_at).getTime())) : 0;
    if (last && now.getTime() - last < MIN_GAP_MS) continue;
    out.push({ lead, step });
  }
  return out;
}

export type Ctx = {
  lead: Lead;
  bookingUrl: string;
  unsubscribeUrl: string;
  address: string;
};

type Block = string | { list: string[]; ordered?: boolean } | { link: string; label: string };

const PILLAR_PLANS: Record<string, { why: string; steps: string[]; metrics: string }> = {
  "Data": {
    why: "Data is where every other system gets its inputs. When the account list is stale or the CRM is full of duplicates, research, scoring, and outreach all inherit the problem.",
    steps: [
      "Write down your ideal customer in a few concrete lines: size, stack, trigger events. Then dedupe and clean the CRM against it.",
      "Turn on automatic enrichment for every new lead, so company, role, and buying context land on the record the moment it is created.",
      "Combine buying signals like hiring, funding, and product usage into one score, and hand reps a refreshed, ranked list every week.",
    ],
    metrics: "Enrichment match rate, Data freshness, Duplicate rate",
  },
  "AI Agents": {
    why: "Research and first drafts are where reps lose the most time. Reps pasting into chat tools on their own gives uneven quality and nothing you can measure.",
    steps: [
      "For one week, have reps note how long they spend researching and writing per account. That is your baseline.",
      "Set up a research agent that writes a short account brief into the CRM before a rep reaches out.",
      "Generate first drafts from that brief, with a rep approving every send. Track how many drafts are approved without edits.",
    ],
    metrics: "Rep selling time, Draft approval rate, Positive reply rate",
  },
  "RevOps": {
    why: "Without routing and a weekly view of the numbers, good leads wait and problems show up a quarter late.",
    steps: [
      "Stand up a weekly dashboard with three numbers: pipeline created, meetings held, and win rate. Review it every week.",
      "Add routing rules so every lead has one owner and a response-time target.",
      "Automate CRM admin like call logging and field updates, then measure how much of the week reps spend with buyers.",
    ],
    metrics: "Speed to lead, Meeting rate, Rep selling time",
  },
};

function firstName(lead: Lead) {
  const n = (lead.name || "").trim().split(/\s+/)[0];
  return n && n.length < 30 ? n : "";
}

/** Returns subject + blocks for one email. Rendering to text/HTML happens in render(). */
export function content(step: number, ctx: Ctx): { subject: string; blocks: Block[] } {
  const { lead } = ctx;
  const sc = lead.source === "scorecard" ? parseScorecard(lead.message) : null;
  const hi = `Hi${firstName(lead) ? " " + firstName(lead) : ""},`;
  const kpiUrl = `${SITE}/downloads/gtm-kpi-scoreboard.xlsx`;

  if (step === 0 && sc) {
    return {
      subject: `Your GTM Scorecard: ${sc.overall}/100`,
      blocks: [
        hi,
        "Thanks for taking the GTM Readiness Scorecard. Here is your result, so you have it in your inbox.",
        `Overall: ${sc.overall}/100 (${sc.band})\nData ${sc.data} · AI Agents ${sc.ai} · RevOps ${sc.revops}`,
        ...(sc.gaps.length ? ["Your top gaps:", { list: sc.gaps, ordered: true }] : []),
        { link: sc.reportUrl, label: "See your full report, with the metrics to watch and your first 90 days" },
        "Over the next two weeks I will send four short emails on fixing the gaps that come up most. If they are not useful, the unsubscribe link is at the bottom.",
      ],
    };
  }
  if (step === 0) {
    return {
      subject: "Your KPI Scoreboard template",
      blocks: [
        hi,
        "Here is the KPI Scoreboard again, in case the download got lost:",
        { link: kpiUrl, label: "Download the GTM KPI Scoreboard (.xlsx)" },
        "The fastest way to get value from it:",
        {
          ordered: true,
          list: [
            "Open the Start Here tab.",
            "Pick five metrics. If you are not sure, start with Qualified pipeline created, Speed to lead, Meeting rate, Win rate, and Rep selling time.",
            "Fill in last month as your baseline before you set any targets.",
          ],
        },
        "That takes about 30 minutes, and the baseline is the part most teams skip. Over the next two weeks I will send four short emails on putting the numbers to work. If they are not useful, the unsubscribe link is at the bottom.",
      ],
    };
  }
  if (step === 1 && sc && PILLAR_PLANS[sc.weakest]) {
    const p = PILLAR_PLANS[sc.weakest];
    return {
      subject: `Fixing your weakest area: ${sc.weakest}`,
      blocks: [
        hi,
        `Your scorecard put ${sc.weakest} lowest, at ${sc[sc.weakest === "Data" ? "data" : sc.weakest === "AI Agents" ? "ai" : "revops"]}/100. ${p.why}`,
        "Here is the order I would fix it in:",
        { list: p.steps, ordered: true },
        `How you will know it is working: watch ${p.metrics}.`,
        "Each step is small enough to start this week. If you want to talk through which one fits your setup, just reply.",
      ],
    };
  }
  if (step === 1) {
    return {
      subject: "Start with speed to lead",
      blocks: [
        hi,
        "If you only fix one number this month, make it speed to lead: the time from a signup or form fill to the first human touch.",
        "It is the cheapest metric to move. You do not need new tools or more headcount, just three things:",
        {
          ordered: true,
          list: [
            "Measure it. Pull the last 30 inbound leads and the time each one got a first reply. Use the median, not the average.",
            "Route it. Every new lead gets one owner automatically, with an alert, instead of whoever sees it first.",
            "Set a target and review it weekly on the Weekly tab of your scoreboard.",
          ],
        },
        "Once that is steady, meeting rate is the next number to watch, because it shows whether faster replies are turning into conversations.",
      ],
    };
  }
  if (step === 2) {
    return {
      subject: "What your reps could open every morning",
      blocks: [
        hi,
        "Most of the gaps in a go-to-market system show up in one place: what a rep sees when they start their day.",
        "We built a live demo of what that can look like. Every account is researched, scored with the reasons shown, matched to the right decision-maker, and has a first draft waiting for a rep to review.",
        { link: `${SITE}/#pipeline`, label: "Open the pipeline demo" },
        "Click any account to see its full dossier, including call notes and the build we would recommend for that company. All of the companies are fictional sample data, but every piece of it is something we set up for real teams.",
      ],
    };
  }
  if (step === 3 && sc) {
    return {
      subject: "Measure it before you fix it",
      blocks: [
        hi,
        "Before changing anything from your scorecard, get a baseline. Otherwise you will not know which fix worked.",
        "We put the scoreboard we use with clients into a free spreadsheet: 22 go-to-market metrics with working formulas, weekly to quarterly tabs, and an experiment log.",
        { link: kpiUrl, label: "Download the KPI Scoreboard (.xlsx)" },
        `Given your scorecard, I would start with the metrics for ${sc.weakest}: ${PILLAR_PLANS[sc.weakest]?.metrics ?? "Speed to lead, Meeting rate, Rep selling time"}.`,
      ],
    };
  }
  if (step === 3) {
    return {
      subject: "Where does your system score?",
      blocks: [
        hi,
        "Once your scoreboard has a few weeks of numbers, the next question is what to fix first.",
        "The GTM Readiness Scorecard answers that in about two minutes. Twelve questions across your data, AI agents, and revenue operations, and you get your three biggest gaps with the metrics to watch for each.",
        { link: `${SITE}/scorecard`, label: "Take the scorecard" },
      ],
    };
  }
  return {
    subject: "Want a second pair of eyes?",
    blocks: [
      hi,
      sc
        ? "You have your scorecard and a plan for your weakest area. If you want help turning it into a working system, the easiest next step is a free 20-minute Pipeline Teardown."
        : "If you want help turning your scoreboard into a working system, the easiest next step is a free 20-minute Pipeline Teardown.",
      "We look at your current setup together, and you leave with three fixes you can use whether or not you hire us. No pitch deck.",
      { link: ctx.bookingUrl, label: "Book a free teardown" },
      "This is the last email in this series. After this, I will only write if you reply.",
    ],
  };
}

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function render(step: number, ctx: Ctx): { subject: string; text: string; html: string } {
  const { subject, blocks } = content(step, ctx);
  const sign = "Will\nVantage Mode";
  const footer = `You are getting this because you used a free tool on vantagemode.com.\nUnsubscribe: ${ctx.unsubscribeUrl}\n${ctx.address}`;
  const text = blocks
    .map((b) =>
      typeof b === "string" ? b
      : "list" in b ? b.list.map((x, i) => `${b.ordered ? i + 1 + "." : "-"} ${x}`).join("\n")
      : `${b.label}: ${b.link}`
    )
    .concat([sign, "--", footer])
    .join("\n\n");
  const P = 'style="margin:0 0 16px;line-height:1.6"';
  const body = blocks
    .map((b) =>
      typeof b === "string" ? `<p ${P}>${esc(b).replace(/\n/g, "<br>")}</p>`
      : "list" in b ? `<${b.ordered ? "ol" : "ul"} style="margin:0 0 16px;padding-left:22px;line-height:1.6">${b.list.map((x) => `<li style="margin-bottom:6px">${esc(x)}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`
      : `<p ${P}><a href="${esc(b.link)}" style="color:#7a5b0b;font-weight:bold">${esc(b.label)} →</a></p>`
    )
    .join("");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1712;max-width:560px;margin:0 auto;padding:8px">
${body}<p ${P}>Will<br>Vantage Mode</p>
<div style="border-top:2px solid #c9a84c;margin-top:28px;padding-top:12px;font-size:12px;color:#5a5346;line-height:1.5">
You are getting this because you used a free tool on vantagemode.com.<br>
<a href="${esc(ctx.unsubscribeUrl)}" style="color:#5a5346">Unsubscribe</a> · ${esc(ctx.address)}</div></div>`;
  return { subject, text, html };
}

/** Unsubscribe token: HMAC of the lowercased email, so links cannot be forged for other addresses. */
export async function unsubToken(email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email.trim().toLowerCase())));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 32);
}
