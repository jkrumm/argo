-- Backfill usage_record.project to the worktree-aware basename used by
-- normalizeProject(). Collapses /Users/jkrumm/{Source,Iu}Root/<repo> and
-- /Users/jkrumm/IuRoot/worktrees/<repo>/<branch>/<repo> to <repo>.
UPDATE "argo"."usage_record"
SET "project" = CASE
  WHEN "project" ~ '/worktrees/' THEN regexp_replace("project", '^.*/worktrees/([^/]+)/.*$', '\1')
  ELSE regexp_replace("project", '^.*/([^/]+)/?$', '\1')
END
WHERE "project" IS NOT NULL AND "project" LIKE '%/%';
