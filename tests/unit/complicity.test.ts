import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { complicityScore, type Answer, type Complicity, type Importance } from "@/lib/complicity";
import fixture from "../fixtures/complicity-cases.json";

type RawAnswer = [number, number, number[] | null, string];
interface Case {
  name: string;
  a: RawAnswer[];
  b: RawAnswer[];
  expected: Complicity;
}

const cases = fixture.cases as Case[];
const toAnswer = ([questionId, optionId, accepted, importance]: RawAnswer): Answer => ({
  questionId,
  optionId,
  accepted,
  importance: importance as Importance,
});

describe("complicityScore (SPEC §9), shared parity cases", () => {
  it("has at least 12 cases, including the ones PROMPT Phase 3 requires", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(cases.some((c) => c.expected.score === null)).toBe(true);
    expect(cases.some((c) => c.expected.capped)).toBe(true);
    expect(cases.some((c) => c.expected.score === 100)).toBe(true);
    expect(cases.some((c) => c.expected.score === 0)).toBe(true);
  });

  it.each(cases)("$name", ({ a, b, expected }) => {
    expect(complicityScore(a.map(toAnswer), b.map(toAnswer))).toEqual(expected);
    // The score is symmetric.
    expect(complicityScore(b.map(toAnswer), a.map(toAnswer))).toEqual(expected);
  });
});

// The same cases, run against public.complicity_score by pgTAP. The SQL file is generated from the
// fixture: this test fails when it is stale (regenerate with UPDATE_PGTAP=1 pnpm test complicity).
const PGTAP_FILE = join(
  __dirname,
  "..",
  "..",
  "supabase",
  "tests",
  "phase3_complicity_parity.test.sql",
);

function renderComplicityPgtap(all: Case[]): string {
  // [answers A, answers B, [score | null, common count, capped], name]
  const data = JSON.stringify(
    all.map((c) => [
      c.a,
      c.b,
      [c.expected.score, c.expected.commonCount, c.expected.capped],
      c.name,
    ]),
  ).replaceAll("'", "''");
  return `-- GENERATED from tests/fixtures/complicity-cases.json by tests/unit/complicity.test.ts. Do not edit.
-- Parity of public.complicity_score with lib/complicity.ts (SPEC §9), in both directions,
-- and of the set-based public.complicity_with (Découverte, Promenade).
-- Run: \`supabase test db\`, or paste this file into the SQL editor / Supabase connector.

create function pg_temp.complicity_member() returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', uid || '@test.local', '',
    now(), '{}', '{}', now(), now());
  insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, role)
  values (uid, 'c' || translate(substr(replace(uid::text, '-', ''), 1, 12), '0123456789', 'ghijklmnop'),
    date '1990-01-01', 'woman', '{man,woman}', 'bad');
  return uid;
end $$;

create function pg_temp.complicity_answers(p_user uuid, p_answers jsonb) returns void language sql as $$
  insert into public.answers (user_id, question_id, option_id, accepted_option_ids, importance)
  select p_user, (x ->> 0)::smallint, (x ->> 1)::smallint,
    case when jsonb_typeof(x -> 2) = 'array'
      then array(select jsonb_array_elements_text(x -> 2)::smallint) end,
    (x ->> 3)::public.importance
  from jsonb_array_elements(p_answers) x
$$;

create function pg_temp.test_complicity_parity() returns setof text language plpgsql as $$
declare
  cases jsonb := '${data}';
  c jsonb; a uuid; b uuid; expected text;
begin
  for c in select value from jsonb_array_elements(cases) loop
    a := pg_temp.complicity_member();
    b := pg_temp.complicity_member();
    perform pg_temp.complicity_answers(a, c -> 0);
    perform pg_temp.complicity_answers(b, c -> 1);
    expected := format('(%s,%s,%s)', coalesce(c -> 2 ->> 0, ''), c -> 2 ->> 1,
      case when (c -> 2 ->> 2)::boolean then 't' else 'f' end);
    return next is((select row(score, common_count, capped)::text from public.complicity_score(a, b)),
      expected, (c ->> 3) || ' (A → B)');
    return next is((select row(score, common_count, capped)::text from public.complicity_score(b, a)),
      expected, (c ->> 3) || ' (B → A)');
    return next is((select w.score from public.complicity_with(a, array[b]) w),
      (c -> 2 ->> 0)::smallint, (c ->> 3) || ' (set-based, Découverte and Promenade)');
  end loop;
end $$;

select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
`;
}

describe("pgTAP parity file", () => {
  it("is up to date with the fixture", () => {
    const rendered = renderComplicityPgtap(cases);
    if (process.env.UPDATE_PGTAP) writeFileSync(PGTAP_FILE, rendered);
    expect(readFileSync(PGTAP_FILE, "utf8")).toBe(rendered);
  });
});
