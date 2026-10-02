// Imports French communes (official reference: geo.api.gouv.fr, Licence Ouverte Etalab) into
// public.places. Idempotent (upsert on country_code + official_code).
//
//   node scripts/import-places.mjs --sql 83 06 > places.sql     SQL for the given departments
//   node scripts/import-places.mjs --push                       whole of France, via the API
//
// --push needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (server-side key, never commit it).
const API = "https://geo.api.gouv.fr";
const FIELDS = "nom,code,codesPostaux,centre,population";

const args = process.argv.slice(2);
const mode = args.includes("--push") ? "push" : "sql";
const departments = args.filter((arg) => !arg.startsWith("--"));

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.json();
}

async function fetchCommunes() {
  if (departments.length === 0) return fetchJson(`${API}/communes?fields=${FIELDS}&format=json`);
  const lists = await Promise.all(
    departments.map((dep) =>
      fetchJson(`${API}/departements/${encodeURIComponent(dep)}/communes?fields=${FIELDS}&format=json`),
    ),
  );
  return lists.flat();
}

function toRow(commune) {
  const [lng, lat] = commune.centre?.coordinates ?? [];
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return {
    country_code: "FR",
    official_code: commune.code,
    name: commune.nom,
    postal_codes: commune.codesPostaux ?? [],
    lat,
    lng,
    population: commune.population ?? null,
  };
}

const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;

function toSql(rows) {
  const values = rows.map(
    (r) =>
      `(${sqlText(r.country_code)}, ${sqlText(r.official_code)}, ${sqlText(r.name)}, ` +
      `array[${r.postal_codes.map(sqlText).join(", ")}]::text[], ${r.lat}, ${r.lng}, ${r.population ?? "null"})`,
  );
  return (
    "insert into public.places (country_code, official_code, name, postal_codes, lat, lng, population) values\n" +
    values.join(",\n") +
    "\non conflict (country_code, official_code) do update set name = excluded.name, " +
    "postal_codes = excluded.postal_codes, lat = excluded.lat, lng = excluded.lng, population = excluded.population;\n"
  );
}

async function push(rows) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required for --push");
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    const response = await fetch(`${url}/rest/v1/places?on_conflict=country_code,official_code`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (!response.ok) throw new Error(`batch ${i}: HTTP ${response.status} ${await response.text()}`);
    process.stderr.write(`${Math.min(i + 1000, rows.length)}/${rows.length}\n`);
  }
}

const rows = (await fetchCommunes()).map(toRow).filter(Boolean);
if (mode === "push") await push(rows);
else process.stdout.write(toSql(rows));
process.stderr.write(`${rows.length} communes ${mode === "push" ? "imported" : "written"}.\n`);
