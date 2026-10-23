// Builds supabase/scripts/prod-apply/: the migrations of phases 6 to 9 for bad-boys-prod, to be run
// by the owner in the SQL Editor (no AI connector writes on the production base). Each script runs
// in one transaction: the exact text of each migration file, then its history row (same text).
// Batches end after each `alter type ... add value`, which must be committed before the new value
// is used. The last script only reads, and compares the base to the files without whitespace.
//
//   node scripts/build-prod-apply.mjs <expected-functions.tsv>
//
// The .tsv comes from a local base built from the files (`supabase db reset`), see the README of
// the folder. Run it again whenever a migration changes.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrations = join(root, "supabase/migrations");
const out = join(root, "supabase/scripts/prod-apply");

/** The last migration of `main`: the base must have it, and nothing after it. */
const BASE = "20261018150000";

const BATCHES = [
  {
    file: "1-phase6-reads-type.sql",
    names: [
      "20261019100000_phase6a_conversation_reads",
      "20261019105900_phase6b_date_cancelled_type",
    ],
  },
  {
    file: "2-phase6-cavale-unmask.sql",
    names: ["20261019110000_phase6b_cavale", "20261019120000_phase6c_unmask"],
  },
  { file: "3-phase7-types.sql", names: ["20261019130000_phase7a_moderation_types"] },
  {
    file: "4-phase7-moderation-pilotage.sql",
    names: ["20261019130100_phase7a_moderation", "20261020090000_phase7b_pilotage"],
  },
  {
    file: "5-phase7-jobs-rgpd.sql",
    names: [
      "20261020110000_phase7c_jobs",
      "20261020110100_phase7c_inactive_fiches",
      "20261020120000_phase7d_rgpd",
    ],
  },
  {
    file: "6-phase7-email-report.sql",
    names: ["20261020130000_phase7e_email", "20261020140000_phase7f_report_message"],
  },
  {
    file: "7-phase8.sql",
    names: ["20261020150000_phase8b_web_vitals", "20261020150100_phase8b_web_vitals_retention"],
  },
  {
    file: "8-phase9.sql",
    names: [
      "20261022090000_phase9a_casier_cliches",
      "20261022100000_phase9b_parloir_nudge",
      "20261022110000_phase9c_recruited_badge",
      "20261023090000_photo_cutout",
    ],
  },
];

const DESTRUCTIVE = /\b(delete|drop|truncate)\b/i;
const md5 = (text) => createHash("md5").update(text).digest("hex");
const bare = (text) => text.replace(/\s/g, "");
const split = (name) => ({ version: name.slice(0, 14), short: name.slice(15) });

const expectedFile = process.argv[2];
if (!expectedFile)
  throw new Error("usage: node scripts/build-prod-apply.mjs <expected-functions.tsv>");

mkdirSync(out, { recursive: true });
const all = [];
let previous = BASE;

BATCHES.forEach((batch, index) => {
  const parts = batch.names.map((name) => {
    const text = readFileSync(join(migrations, `${name}.sql`), "utf8");
    if (text.includes("$mig$")) throw new Error(`${name} contains $mig$`);
    const { version, short } = split(name);
    all.push({ version, short, hash: md5(bare(text)), destructive: DESTRUCTIVE.test(text) });
    return { name, version, short, text };
  });
  const first = parts[0].version;
  const destructive = parts.filter((p) => DESTRUCTIVE.test(p.text)).map((p) => p.short);
  const lines = [
    `-- bad-boys-prod (hmmobtyherwuhrhymfbk). Script ${index + 1} sur ${BATCHES.length + 1}, à lancer dans l'ordre, dans le SQL Editor.`,
    `-- Généré par scripts/build-prod-apply.mjs (ne pas modifier à la main). Une seule transaction :`,
    `-- en cas d'erreur, rien n'est appliqué ; relancer le même script après correction.`,
    `-- Migrations (texte exact des fichiers, puis leur ligne d'historique) :`,
    ...parts.map((p) => `--   ${p.name}.sql`),
    destructive.length
      ? `-- Contient un mot destructif (delete, drop ou truncate), dans : ${destructive.join(", ")}. L'éditeur demandera une confirmation.`
      : `-- Aucun mot destructif.`,
    "",
    "begin;",
    "",
    "-- Garde : la base est à l'étape précédente, et ce script n'a pas déjà été lancé.",
    "do $guard$",
    "begin",
    `  if not exists (select 1 from supabase_migrations.schema_migrations where version = '${previous}') then`,
    `    raise exception 'étape précédente absente (${previous}) : lancer les scripts dans l''ordre';`,
    "  end if;",
    `  if exists (select 1 from supabase_migrations.schema_migrations where version >= '${first}') then`,
    `    raise exception 'déjà appliqué (${first} ou plus récent présent)';`,
    "  end if;",
    "end",
    "$guard$;",
    "",
  ];
  for (const part of parts) {
    lines.push(
      `-- ===== ${part.name}.sql =====`,
      part.text.trimEnd(),
      "",
      "insert into supabase_migrations.schema_migrations (version, name, statements)",
      `values ('${part.version}', '${part.short}', array[$mig$${part.text}$mig$]);`,
      "",
    );
  }
  lines.push(
    "commit;",
    "",
    "-- Empreintes (sans les blancs) : colonne attendu = colonne base.",
    "select m.version, m.name, x.expected as attendu, md5(regexp_replace(array_to_string(m.statements, ';'), '\\s', '', 'g')) as base",
    "from supabase_migrations.schema_migrations m",
    "join (values",
    parts.map((p) => `  ('${p.version}', '${md5(bare(p.text))}')`).join(",\n"),
    ") as x (version, expected) on x.version = m.version",
    "order by m.version;",
    "",
  );
  writeFileSync(join(out, batch.file), lines.join("\n"));
  previous = parts[parts.length - 1].version;
});

// Script 7: read only. History, functions (text and rights), RLS, scheduled jobs.
const expected = readFileSync(expectedFile, "utf8")
  .trim()
  .split("\n")
  .map((line) => line.split("\t"));
const quote = (value) => `'${value.replace(/'/g, "''")}'`;
const verify = [
  `-- bad-boys-prod (hmmobtyherwuhrhymfbk). Script ${BATCHES.length + 1} sur ${BATCHES.length + 1} : contrôle, lecture seule (aucune écriture).`,
  "-- Généré par scripts/build-prod-apply.mjs. Référence : une base locale construite avec les fichiers.",
  "-- Comparaison sans les blancs (règle du conseiller du 2026-10-22). La colonne « sans_commentaires »",
  "-- « dont_commentaires_seuls » dit en plus combien d'écarts ne tiennent qu'aux commentaires `--`",
  "-- (information pour le conseiller, pas une règle).",
  "-- Attendu : 0 partout, sauf « historique_ok » = " + all.length + ".",
  "",
  "-- 1. Historique des migrations des phases 6 à 9",
  "select count(*) filter (where md5(regexp_replace(array_to_string(m.statements, ';'), '\\s', '', 'g')) = x.expected and m.name = x.name) as historique_ok,",
  "  count(*) filter (where m.version is null) as historique_absent,",
  "  count(*) filter (where m.version is not null and (md5(regexp_replace(array_to_string(m.statements, ';'), '\\s', '', 'g')) <> x.expected or m.name <> x.name)) as historique_different",
  "from (values",
  all.map((m) => `  ('${m.version}', '${m.short}', '${m.hash}')`).join(",\n"),
  ") as x (version, name, expected)",
  "left join supabase_migrations.schema_migrations m on m.version = x.version;",
  "",
  "-- 2. Fonctions de public et private : texte (sans les blancs), security definer, droits anon / authenticated",
  "with expected (signature, body, body_no_comments, secdef, anon, auth) as (values",
  expected
    .map(
      ([signature, body, bodyNoComments, secdef, anon, auth]) =>
        `  (${quote(signature)}, '${body}', '${bodyNoComments}', ${secdef === "t"}, ${anon === "t"}, ${auth === "t"})`,
    )
    .join(",\n"),
  "), actual as (",
  "  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,",
  "    md5(regexp_replace(p.prosrc, '\\s', '', 'g')) as body,",
  "    md5(regexp_replace(regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'), '\\s', '', 'g')) as body_no_comments,",
  "    p.prosecdef as secdef, has_function_privilege('anon', p.oid, 'execute') as anon,",
  "    has_function_privilege('authenticated', p.oid, 'execute') as auth",
  "  from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
  "  where n.nspname in ('public', 'private')",
  "    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')",
  "    and p.proname <> 'rls_auto_enable' -- fonction de la plateforme Supabase, absente des fichiers",
  ")",
  "select count(*) filter (where a.signature is null) as fonction_absente,",
  "  count(*) filter (where e.signature is null) as fonction_en_trop,",
  "  count(*) filter (where e.body <> a.body) as texte_different,",
  "  count(*) filter (where e.body <> a.body and e.body_no_comments = a.body_no_comments) as dont_commentaires_seuls,",
  "  count(*) filter (where e.secdef <> a.secdef or e.anon <> a.anon or e.auth <> a.auth) as droits_differents,",
  "  string_agg(coalesce(a.signature, e.signature), ', ') filter (where a.signature is null or e.signature is null",
  "    or e.body <> a.body or e.secdef <> a.secdef or e.anon <> a.anon or e.auth <> a.auth) as lesquelles",
  "from expected e full join actual a on a.signature = e.signature;",
  "",
  "-- 3. Tables sans RLS, droits de anon sur les tables",
  "select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace",
  "        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as tables_sans_rls,",
  "  (select count(*) from information_schema.role_table_grants",
  "   where grantee = 'anon' and table_schema = 'public') as droits_anon_tables;",
  "",
  "-- 4. Tâches planifiées (pg_cron) attendues après les phases 6 à 9",
  "select string_agg(jobname || ' ' || schedule, ' | ' order by jobname) as taches from cron.job;",
  "",
];
writeFileSync(join(out, `${BATCHES.length + 1}-verify.sql`), verify.join("\n"));

console.log(
  all
    .map((m) => `${m.version} ${m.short} ${m.hash}${m.destructive ? " (destructif)" : ""}`)
    .join("\n"),
);
