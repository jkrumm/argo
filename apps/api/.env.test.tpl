# Integration-test database: the mini's maintained Postgres, admin role. scripts/test.sh creates and
# drops an argo_test_<random> scratch database with it (the app role `argo` can only SELECT on the
# `usage` schema, so tests that seed usage rows need to be admin). Resolved by secrets-run in
# `bun test:api`; the refs mirror usage-tracker/.env.test.tpl.
ARGO_TEST_PG_USER=op://vps/config/POSTGRES_USER
ARGO_TEST_PG_PASSWORD=op://mini/vps-dev/POSTGRES_PASSWORD
