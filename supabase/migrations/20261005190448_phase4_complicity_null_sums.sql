-- Phase 4a fix: a filtered sum over no accepted answer is NULL, not 0. complicity_with and the
-- Promenade then got no score (or 50 when capped) where complicity_score gives 0. The shared
-- rounding now reads a missing sum as 0, for every caller.
create or replace function public.complicity_from_sums(n_a bigint, d_a bigint, n_b bigint, d_b bigint, cnt integer, cap boolean)
returns smallint language plpgsql immutable set search_path = '' as $$
declare p bigint; q bigint; s bigint;
begin
  n_a := coalesce(n_a, 0); d_a := coalesce(d_a, 0); n_b := coalesce(n_b, 0); d_b := coalesce(d_b, 0);
  if cnt is null or cnt < 5 or d_a = 0 or d_b = 0 then return null; end if;
  p := 40000 * n_a * n_b;
  q := d_a * d_b;
  s := round(100 * sqrt((n_a * n_b)::double precision / q))::bigint;
  while s > 0 and (2 * s - 1) * (2 * s - 1) * q > p loop s := s - 1; end loop;
  while (2 * s + 1) * (2 * s + 1) * q <= p loop s := s + 1; end loop;
  if coalesce(cap, false) then s := least(s, 50); end if;
  return s::smallint;
end;
$$;
