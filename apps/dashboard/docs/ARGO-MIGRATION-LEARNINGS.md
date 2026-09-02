# argo → basalt-ui migration learnings

Ledger of every basalt export this migration adopted, rejected or found a gap in. One row per export per wave. Feeds basalt-ui's 1.30.0 adopt-or-delete verdicts.

| Wave | basalt export                                        | Verdict | argo file                        | Reason                                                                |
| ---- | ---------------------------------------------------- | ------- | -------------------------------- | --------------------------------------------------------------------- |
| W0   | inputProps + fieldKey (forms)                        | adopt   | src/lib/auth-gate.tsx            | replaces the removed `field` alias                                    |
| W0   | configs/tsconfig.react-app.json + tsconfig.node.json | adopt   | apps/dashboard/tsconfig.\*.json  | restores 5 (app) / 9 (node) strictness flags                          |
| W0   | noPropertyAccessFromIndexSignature (tsconfig flag)   | gap     | apps/dashboard/tsconfig.app.json | disabled — 83 index-signature access sites exceed the 15-error budget |
| W0   | exactOptionalPropertyTypes (tsconfig flag)           | gap     | apps/dashboard/tsconfig.app.json | disabled — 56 exact-optional sites exceed the 15-error budget         |
