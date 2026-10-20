#!/usr/bin/env node
// Prints a read-only SELECT that runs the lead bot rules against existing public.leads rows,
// built from the body of private.lead_bot_reasons in the bot-flag migration, so the numbers
// always match the rules that will run. Paste the output into the Supabase SQL editor or MCP
// execute_sql. It writes nothing and needs nothing applied first.
//
//   node scripts/bot_flag_impact.mjs            counts only (no names or emails)
//   node scripts/bot_flag_impact.mjs --flagged  one line per flagged non-demo row:
//                                               created_at, source, status, rules (no names or emails)
//
// Rows the trigger would skip (demo rows and source 'booking') are still counted, and labeled.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations", "20261019120000_leads_bot_flag.sql");
const sql = readFileSync(FILE, "utf8");
const m = sql.match(/function private\.lead_bot_reasons\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/);
if (!m) {
  console.error("could not find the body of private.lead_bot_reasons in", FILE);
  process.exit(2);
}
const body = m[1]
  .replace(/--[^\n]*/g, "")
  .replace(/\bp_name\b/g, "l.name")
  .replace(/\bp_company\b/g, "coalesce(l.brand, l.company)")
  .replace(/\bp_email\b/g, "l.email")
  .trim();

const base = `with r as (
  select l.created_at, l.source, l.status, l.is_demo,
         (l.is_demo or l.source = 'booking') as trigger_skips,
         (${body}) as reasons
  from public.leads l
)`;

const counts = `${base}
select
  count(*)                                                        as rows_checked,
  count(*) filter (where cardinality(reasons) > 0)                as rows_flagged,
  count(*) filter (where cardinality(reasons) > 0 and not is_demo) as flagged_non_demo,
  count(*) filter (where cardinality(reasons) > 0 and is_demo)     as flagged_demo,
  count(*) filter (where cardinality(reasons) > 0 and not trigger_skips and status = 'new') as would_become_spam_if_new_today,
  count(*) filter (where 'name_mixed_case' = any(reasons))         as name_mixed_case,
  count(*) filter (where 'name_consonant_run' = any(reasons))      as name_consonant_run,
  count(*) filter (where 'company_mixed_case' = any(reasons))      as company_mixed_case,
  count(*) filter (where 'company_consonant_run' = any(reasons))   as company_consonant_run,
  count(*) filter (where 'gmail_dots' = any(reasons))              as gmail_dots
from r;`;

const flagged = `${base}
select created_at, source, status, is_demo, trigger_skips, reasons
from r
where cardinality(reasons) > 0 and not is_demo
order by created_at;`;

console.log(process.argv.includes("--flagged") ? flagged : counts);
