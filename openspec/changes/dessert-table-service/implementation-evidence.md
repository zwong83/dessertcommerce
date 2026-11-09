# SweetCommerce v1 implementation evidence

The owner asked to complete both delivery increments and publish the application repository. Development and verification used synthetic identities, payment evidence, receipts, refunds and provider outcomes.

| Scope | Evidence |
| --- | --- |
| HTTP contracts | The FastAPI route inventory matches all 61 OpenAPI 0.4.1 operations, including the 49 operations in the 0.4.0 standard subset. The TypeScript contract generator verifies both versions. |
| Standard order | Integration cases cover checkout, fee consent, Cash pickup, timed proof, split top-up, cancellation and independent settlement, hold release, fulfilment, delivery adjustments and refund reservations. |
| Dessert table | Event cases cover owned applications, overlap and quote races, positive 50% instalments, late verification, effective balance cutoffs, pre-transfer cancellation, consented reschedule, equipment, extras and refunds. |
| Notices and reports | PostgreSQL tests cover fenced delivery, safe retries, ambiguous send follow-up, current deadline and amount checks, authorized work targets, MYT dates, ledger category and quote cohort reconciliation. |
| Operations | Clean PostgreSQL 16 bootstrap, additive upgrade from 0001, checksum refusal, and role privileges were verified. The API includes private liveness and readiness checks, production gateway adapters, and independent timer and notice worker modes. |

## Verification

- `node_modules/.bin/tsx scripts/test-python.ts` passed 172 tests against isolated PostgreSQL 16.
- `npm run check` passed contract generation, TypeScript checks and 73 tests. `NEXT_TELEMETRY_DISABLED=1 npm run build` passed.
- `node_modules/.bin/tsx scripts/test-web-python.ts` passed with the Next.js production build, FastAPI, the Worker and PostgreSQL. It exercised the prior migration ledger and queued expiry, standard DuitNow through pickup completion, and dessert-table application through quote, protected deposit review and booked state with a separate balance.
- Chromium smoke verified keyboard sign-in, a 390 px customer viewport, cart, event intake rendering and merchant route denial. The desktop check verified merchant sign-in, reporting input and the work queue.
- `openspec validate --all --strict` validated both changes.

The remaining evidence tasks cover the full browser and merchant UAT matrix, the sustained workload, and the production backup and restore drill. Commercial activation also requires real gateway enrolment, merchant terms and verified payment and privacy procedures. The local launcher and test credentials are synthetic.
