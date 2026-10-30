# Argo secrets for the native mini deploy: one op:// ref per line, resolved by scripts/launch.sh through
# secrets-run (fail-closed: exit 78 unless every ref resolves to a non-empty value). Non-secret config
# (PORT, DATA_DIR, GIT_SHA, CRONS_ENABLED, ...) lives in deploy/com.jkrumm.argo.plist.template.
#
# NOT here yet (added at the cutover wave): GOOGLE_*, GARMIN_HEARTBEAT_URL, DOCKER_*.
#
# Assembled by launch.sh after resolution: DATABASE_URL (from ARGO_DB_PASSWORD) and
# OTEL_EXPORTER_OTLP_HEADERS (from OTEL_EXPORTER_OTLP_AUTHORIZATION).
ARGO_DB_PASSWORD=op://vps/argo/DB_PASSWORD
API_SECRET=op://common/api/SECRET
OTEL_EXPORTER_OTLP_ENDPOINT=op://mini/agent-workflows/OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_EXPORTER_OTLP_AUTHORIZATION=op://vps/argo/HYPERDX_API_KEY_PROD
TICKTICK_API_KEY=op://common/ticktick/API_KEY
UPTIME_KUMA_URL=op://common/uptime-kuma/URL
UPTIME_KUMA_USERNAME=op://common/uptime-kuma/USERNAME
UPTIME_KUMA_PASSWORD=op://common/uptime-kuma/PASSWORD
UPTIME_KUMA_API_KEY=op://common/uptime-kuma/API_KEY
SLACK_BOT_TOKEN=op://common/slack/ARGO_BOT_TOKEN
SLACK_READ_TOKEN=op://common/slack/BOT_TOKEN
SLACK_USER_TOKEN=op://common/slack/USER_TOKEN
GARMIN_API_KEY=op://vps/argo/GARMIN_API_KEY
ATLASSIAN_BASE_URL=op://vps/argo/ATLASSIAN_BASE_URL
JIRA_EMAIL=op://vps/argo/ATLASSIAN_EMAIL
JIRA_API_TOKEN=op://vps/argo/ATLASSIAN_API
GITLAB_TOKEN=op://vps/argo/GITLAB_TOKEN
HARDCOVER_API_KEY=op://vps/argo/HARDCOVER_API_KEY
DEEPSEEK_BASE_URL=op://common/anthropic/OPENAI_BASE_URL
DEEPSEEK_API_KEY=op://common/anthropic/API_KEY
