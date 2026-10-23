-- Reference for 9-verify.sql: run on a local base built from the files (see README.md).
select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
  md5(regexp_replace(p.prosrc, '\s', '', 'g')),
  md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s', '', 'g')),
  p.prosecdef, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
order by 1;
