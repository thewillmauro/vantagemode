#!/usr/bin/env node
// Fails (exit 1) if any supabase/migrations/*.sql file's version is not in production's
// migration history, or if its content differs from what production recorded under that
// version. Exit 2 means the check could not run (bad input, network, auth).
//
// Production history comes from one of two places. No secrets live in the repo:
//
//   1. Live, read-only, via the Supabase Management API:
//        SUPABASE_ACCESS_TOKEN=... node scripts/check_migrations.mjs
//      (project ref defaults to tnkqxniwjomkojufuxlp; override with SUPABASE_PROJECT_REF)
//
//   2. A saved copy of the history, as JSON, from the Supabase MCP or the SQL editor:
//        node scripts/check_migrations.mjs --history history.json
//      Produce the JSON with this read-only query (HISTORY_SQL below):
//        select version, name, md5(regexp_replace(regexp_replace(
//          array_to_string(statements, E'\n'), '--[^\n]*', '', 'g'), '\s+', '', 'g')) as norm_md5
//        from supabase_migrations.schema_migrations order by version;
//      The file is a JSON array of {version, name?, norm_md5?}. A plain list of versions,
//      one per line, also works (then only versions are checked).
//
// Content check: norm_md5 is md5 of the SQL with "--" comments and all whitespace removed,
// so header comments in our files never cause a mismatch, but any real SQL change does.
//
// Options: --dir <path> checks another migrations folder (default supabase/migrations).

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HISTORY_SQL = String.raw`select version, name, md5(regexp_replace(regexp_replace(array_to_string(statements, E'\n'), '--[^\n]*', '', 'g'), '\s+', '', 'g')) as norm_md5 from supabase_migrations.schema_migrations order by version`;

export function normMd5(sql) {
  return createHash('md5').update(sql.replace(/--[^\n]*/g, '').replace(/\s+/g, '')).digest('hex');
}

export function parseHistory(text) {
  const t = text.trim();
  if (t.startsWith('[')) {
    return JSON.parse(t).map((r) => ({ version: String(r.version), name: r.name, norm_md5: r.norm_md5 }));
  }
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
    if (h.name && h.name !== name) notes.push(`${file}: production names ${version} "${h.name}"`);
    if (h.norm_md5 && h.norm_md5 !== normMd5(sql)) {
      failures.push(`${file}: content differs from production's ${version} ${h.name ?? ''}`.trim());
    }
  }
  for (const h of history) {
    if (!seen.has(h.version)) notes.push(`production ${h.version} ${h.name ?? ''} has no file in the repo`.trim());
  }
  return { failures, notes };
}

async function fetchLive() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF || 'tnkqxniwjomkojufuxlp';
  if (!token) throw new Error('set SUPABASE_ACCESS_TOKEN, or pass --history <file>');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: HISTORY_SQL, read_only: true }),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return parseHistory(await res.text());
}

async function main(argv) {
  const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = arg('--dir') ?? join(root, 'supabase', 'migrations');
  const historyFile = arg('--history');

  let history;
  try {
    history = historyFile ? parseHistory(readFileSync(historyFile, 'utf8')) : await fetchLive();
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
    console.log(`check_migrations: ${failures.length} of ${files.length} migration files do not match production's history`);
    return 1;
  }
  console.log(`check_migrations: OK, all ${files.length} migration files match production's history (${history.length} entries)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
