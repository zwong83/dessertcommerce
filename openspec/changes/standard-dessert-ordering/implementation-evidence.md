# SweetCommerce Increment 1 · Apply evidence

9 November 2026 · Local greenfield workspace · Apply in progress

## Completed task evidence

| Task | Observed result |
| --- | --- |
| 1.1 | Next.js 16.4.5 on Node 25.8.0 compiled with TypeScript 5.9.3. The build contains separate customer and merchant routes and the server API. The separate Node worker entry and boundary/shutdown tests passed. The isolated runner served the built feature paths on loopback in development mode. |
| 1.2 | PostgreSQL 16.15 migration and isolated harness passed concurrent clean bootstrap, constraints, least-privilege grants, receipt locking, rollback on failed writes, compatibility with an earlier synthetic reader and tampered history denial. Cross-version binaries and full dump/restore belong to the remaining delivery evidence. |
| 2.2 | Real database and HTTP-adapter tests verified owned carts, persistence across sessions, reference totals, invalid/unavailable edits, stale and conflicting replay protection, removal and new line generation, with no production allocation. |
| 2.3 | Catalogue tests verified filtered visibility, drafts and publication, preserved historical snapshots, stale and invalid updates, photo limits and gallery scope. Actual loopback Next.js HTTP verified local image decoding, staging, protected preview, ordered save and customer-visible attached media. |
| 2.4 | PostgreSQL tests verified MYT boundaries, allocation races, same-day reallocation, used versus unused capacity, stale impact previews and valid/invalid calendar changes. All six capacity HTTP operations were exercised with real sessions and CSRF. |
| 3.1 | PostgreSQL checkout cases SC-26–29 verified complete review, exact DuitNow hold and durable expiry, no hold for waiting Cash/fee intake, rechecks, concurrent retry, submit/abandon, and historical owner reads. A fresh Next.js loopback run created and replayed a Cash pickup order and rendered its protected detail. |

## Commands and scope

- `npm run check` passed generated contract consistency, Next route type generation and TypeScript. The Node test runner reported 56 passed, zero failed.
- `NEXT_TELEMETRY_DISABLED=1 npm run build` built the application successfully.
- `openspec validate --all --strict --no-interactive --json` reported both changes valid and zero issues.
- Loopback smoke used a disposable PostgreSQL 16.15 database, an enrolled synthetic administrator, a synthetic OTP, a generated PNG and Cash pickup intake. It verified role denial, logout, catalogue access, media staging and visibility, capacity preview/confirmation, order submission replay, the owned order page and the guest redirect on merchant catalogue access. It exercised local HTTP and server-rendered pages. It did not exercise a graphical browser matrix, actual payment, or external OTP delivery.
- The expiry test used the restricted worker role and verified old-lease denial, unused hold release once, and timely proof protection. Proof upload, actual payment and top-up adjudication, merchant actions, refund, complete worker recovery, broader UI and the remaining TA execution are still open.

The approved contract remains OpenAPI 0.4.0 for this increment. [Tasks](tasks.md) records the completed slice and remaining work. Launch acceptance, regression completion and convergence are pending.

## SD 0.5 runtime migration evidence

Environment on 9 November 2026 uses Python 3.12.13, FastAPI 0.162.2, PostgreSQL 16.15 and Next.js 16.4.5. Verification uses synthetic fixtures and loopback processes.

| Task | Evidence |
| --- | --- |
| 7.1 · SD/OpenSpec | SD 0.5 records the FastAPI and Python worker runtime, DDD layers, relay and rollback boundary. SA 1.2 continues to govern behavior. OpenAPI 0.4.0 and the existing PostgreSQL SQL and checksummed migration history carry forward. Both OpenSpec changes passed strict validation. |
| 7.2 · FastAPI | Provider inventory matched all 29 operations implemented by the reference runtime. Python tests cover role-bound OTP and recovery, existing sessions and encrypted challenges, cart replay, catalogue/gallery and existing encrypted objects, MYT capacity and last-unit races, and checkout snapshot, idempotency and submit/abandon races. |
| 7.3 · Worker | Separate worker role and process. PostgreSQL tests cover lease fencing, duplicate and delayed work, early deferral, proof before and at cutoff, retry after rollback and atomic release. The process test expired an order and released its hold from a job written by the TypeScript runtime. |
| 7.4 · Web and regression | Next.js relays same-origin requests and renders protected pages from FastAPI. A running-system test verified the pre-cutover OTP challenge, session, cart receipt and open review, original terms, role redirects, binary upload/read, logout and queued expiry. The Python migration runner accepted the existing TypeScript ledger without applying a new migration. The local launcher started the API, worker, web and fresh PostgreSQL database. |

- `npm run check` passed contract generation, type checks and all 56 TypeScript tests. `NEXT_TELEMETRY_DISABLED=1 npm run build` passed.
- `node_modules/.bin/tsx scripts/test-python.ts` passed all 57 Python cases against isolated PostgreSQL, including schema, grants and response contract checks.
- `node_modules/.bin/tsx scripts/test-web-python.ts` passed the production-build bridge and cross-runtime tests.
- FastAPI declares errors as `application/problem+json` per OpenAPI 0.4.0 and retains the prior JSON fields and statuses. Pillow sanitizes and re-encodes new media; the existing encrypted object format remains readable.
- The TypeScript implementation remains a local comparison fixture. Proof upload, merchant order/settlement actions, refunds, commercial launch verification and remaining Increment 1 acceptance tasks retain their individual status above.

## Standard-order completion

The standard provider implements the 49 operations assigned to OpenAPI 0.4.0. Next.js adds customer order tracking, fee consent, proof and cancellation, and merchant work, capacity, fulfilment, proof, settlement and refund views. The isolated integration suite checks version conflicts, actor isolation, cart generation, actual handoff, shortfalls and exact deadlines, immutable receipts, and replay and concurrency around cancellation and refunds.

Migration 0001 and its checksum are preserved. The shared v1 runtime also serves Increment 2. See [commercial implementation evidence](../dessert-table-service/implementation-evidence.md) for combined results and the remaining release checks.
