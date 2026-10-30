-- One line per table of schema argo: name|rows|md5 over the sorted row hashes. Row text is rendered in UTC so
-- the session timezone of either side cannot matter. @@EXCLUDE@@ is replaced with the quoted legacy table list.
SET timezone = 'UTC';
SELECT format(
  'SELECT %L, count(*), coalesce(md5(string_agg(md5(t::text), %L ORDER BY md5(t::text))), %L) FROM argo.%I t',
  c.relname, '', 'empty', c.relname)
FROM pg_class c
WHERE c.relnamespace = 'argo'::regnamespace AND c.relkind = 'r' AND c.relname NOT IN (@@EXCLUDE@@)
ORDER BY c.relname
\gexec
