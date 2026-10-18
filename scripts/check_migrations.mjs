#!/usr/bin/env node
// Fails (exit 1) if any supabase/migrations/*.sql file does not match production's migration
// history: its version is missing, its name differs, or (when production's statements are
// available) its SQL differs. Exit 2 means the check could not run (missing or unreadable history file).
//
// Production history comes from a JSON file passed with --history. No secrets live in the repo,
// and no Management API token is used.
//
//   node scripts/check_migrations.mjs --history history.json
//
//   * Full check (local): export with this read-only query, from the Supabase MCP or SQL editor:
//       select coalesce(json_agg(h order by version), '[]') from (
//         select version, name, md5(regexp_replace(regexp_replace(
//           array_to_string(statements, E'\n'), '--[^\n]*', '', 'g'), '\s+', '', 'g')) as norm_md5
//         from supabase_migrations.schema_migrations) h;
//   * Version and name only: rows of {version, name} (for example the MCP list_migrations output).
//
// The file is a JSON array of {version, name?, norm_md5?, statements?}. A plain list of
// versions, one per line, also works (then only versions are checked).
//
// Content check: norm_md5 is md5 of the SQL with "--" comments and all whitespace removed,
// so header comments in our files never cause a mismatch, but any real SQL change does.
//
// Options: --dir <path> checks another migrations folder (default supabase/migrations).

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function normMd5(sql) {
  return createHash('md5').update(sql.replace(/--[^\n]*/g, '').replace(/\s+/g, '')).digest('hex');
}

function toEntry(r) {
  const e = { version: String(r.version), name: r.name ?? undefined, norm_md5: r.norm_md5 ?? undefined };
  if (!e.norm_md5 && Array.isArray(r.statements)) e.norm_md5 = normMd5(r.statements.join('\n'));
  return e;
}

export function parseHistory(text) {
  const t = text.trim();
  if (t.startsWith('[')) return JSON.parse(t).map(toEntry);
  return t.split(/\s+/).filter(Boolean).map((version) => ({ version }));
}

// files: [{ file, sql }]. Returns { failures: string[], notes: string[] }.
export function compare(files, history) {
  const byVersion = new Map(history.map((h) => [h.version, h]));
  const failures = [];
  const notes = [];
  const seen = new Set();
  for (const { file, sql } of files) {
    const m = /^(\d{14})_(.+)\.sql$/.exec(file);
    if (!m) { failures.push(`${file}: name is not <14-digit version>_<name>.sql`); continue; }
    const [, version, name] = m;
    if (seen.has(version)) failures.push(`${file}: version ${version} is used by more than one file`);
    seen.add(version);
    const h = byVersion.get(version);
    if (!h) { failures.push(`${file}: version ${version} is not in production's history`); continue; }
    if (h.name && h.name !== name) failures.push(`${file}: production names ${version} "${h.name}"`);
    if (h.norm_md5 && h.norm_md5 !== normMd5(sql)) {
      failures.push(`${file}: content differs from production's ${version} ${h.name ?? ''}`.trim());
    }
  }
  for (const h of history) {
    if (!seen.has(h.version)) notes.push(`production ${h.version} ${h.name ?? ''} has no file in the repo`.trim());
  }
  return { failures, notes };
}

async function main(argv) {
  const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = arg('--dir') ?? join(root, 'supabase', 'migrations');
  const historyFile = arg('--history');

  if (!historyFile) { console.error('check_migrations: pass --history <file> (see the header of this script)'); return 2; }
  let history;
  try {
    history = parseHistory(readFileSync(historyFile, 'utf8'));
  } catch (e) {
    console.error(`check_migrations: could not load production history: ${e.message}`);
    return 2;
  }
  if (history.length === 0) { console.error('check_migrations: production history is empty'); return 2; }

  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((file) => ({ file, sql: readFileSync(join(dir, file), 'utf8') }));
  const { failures, notes } = compare(files, history);

  for (const n of notes) console.log(`note: ${n}`);
  if (failures.length) {
    for (const f of failures) console.log(`FAIL: ${f}`);
    console.log(`check_migrations: ${failures.length} problem(s) in ${files.length} migration files vs production's history`);
    return 1;
  }
  console.log(`check_migrations: OK, all ${files.length} migration files match production's history (${history.length} entries)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
