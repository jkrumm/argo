-- usage-tracker renamed its agent-gateway sources and lanes (2026-10-13) and
-- migrated its local rows in place without re-pushing them, so the rows already
-- stored here are carried over to the new names.
-- A twin under the new name (same source_id + machine) would violate
-- uq_usage_source_sourceid_machine on the UPDATE; the old-name copy goes first.
DELETE FROM "argo"."usage_record" o
USING "argo"."usage_record" n
WHERE o.source IN ('sideclaw-iu', 'sideclaw-sessions')
  AND n.source = CASE o.source
    WHEN 'sideclaw-iu' THEN 'agent-gateway-iu'
    ELSE 'agent-gateway-sessions'
  END
  AND n.source_id = o.source_id
  AND n.machine = o.machine;--> statement-breakpoint
UPDATE "argo"."usage_record"
SET "source" = CASE "source"
  WHEN 'sideclaw-iu' THEN 'agent-gateway-iu'
  ELSE 'agent-gateway-sessions'
END
WHERE "source" IN ('sideclaw-iu', 'sideclaw-sessions');--> statement-breakpoint
UPDATE "argo"."usage_record"
SET "sub_tool" = 'agent-gateway:' || substr("sub_tool", length('sideclaw:') + 1)
WHERE "sub_tool" LIKE 'sideclaw:%';
