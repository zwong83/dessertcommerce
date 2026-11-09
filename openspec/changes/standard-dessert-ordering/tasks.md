**Increment 1 application flows implemented.** The [Test Analysis](test-analysis.md) supplies planned cases and task routing. See [implementation evidence](implementation-evidence.md), the [source baseline](proposal.md#source-baseline) and [contract operation ownership](design.md#contract-operations-and-task-ownership).

## 1. Project and test baseline

- [x] 1.1 Establish the TypeScript/Next.js web and Node.js worker entry points for the reference implementation, role route groups, module boundaries and reproducible local checks. Record dependency versions and verify no cross-module direct writes. D01.
- [x] 1.2 Add the first-increment PostgreSQL migration set and isolated synthetic test harness with deterministic clock and OTP/storage adapters. Prove clean bootstrap, keys, least-privilege runtime grants and rollback/forward compatibility. D01, D05.
- [x] 1.3 Establish checked API types, shared error mapping, authentication context and provider/consumer fixtures for the approved increment 1 subset of OpenAPI 0.4.0. Include the owned checkout snapshot, top-up projection, cancellation confirmation and guarded merchant actions. D01–D02.

## 2. Identity, cart and catalogue

- [x] 2.1 Implement role-bound OTP, encrypted temporary phone binding, logout/revocation and enrolled merchant recovery. Verify expired, foreign and reused codes, throttling, provider outage, role/owner denials and a recovery reset racing earlier verification. Keep the all-channel loss runbook subject to its launch decision. CUS-01, OPS-01, D02.
- [x] 2.2 Implement account-owned persistent cart, reference subtotal and versioned edits with stable line generations. Verify cross-device writes, invalid quantities/unavailable variants, remove/re-add and removal without allocation. CUS-02–03, D02.
- [x] 2.3 Implement catalogue drafts, validation, fixed variants/flavours, price, preparation, categories and publication controls. Preserve historical snapshots. Implement scoped staging/preview and versioned ordered-gallery save with the approved CAT-05 limits. Test stale saves, invalid/foreign media, and eligible saved storefront images. CAT-01, CAT-05, D03.
- [x] 2.4 Implement operating calendar and MYT eligibility, day/product limits and impact preview/confirm. Test cutoff and last-unit races on PostgreSQL, pending orders invalidating previews, lower-than-used cap rejection and closure preserving commitments. CAT-02–04, D03.

## 3. Checkout and fulfilment

- [x] 3.1 Implement complete checkout review, single-use submission, idempotency and owned outcome/abandon. Verify edits to contacts, fulfilment, flavour or terms require new review. Check stored snapshot through owned GET after catalogue/terms changes and race late submit against abandonment. ORD-01, CUS-03, D03.
- [x] 3.2 Implement fixed pickup, merchant fee/time revisions and customer-arranged Lalamove with separate external fee. Verify counteroffers, no allocation while waiting, stale consent rejection and revalidation at commitment. ORD-02, CAT-03, D03.
- [x] 3.3 Implement owned list/detail and guarded merchant accept/prepare/ready, driver arrival and actual handoff. Verify driver arrival cannot mark handoff, one-time cart consumption, status/role guards and restricted customer timeline. ORD-03, CUS-03, D02–D03.
- [x] 3.4 Implement pre/post-handoff incident recovery, consented redelivery/reschedule, atomic reallocation, same-day remake generation and separate delivery adjustments. Verify rollback preserves the earlier promise and no charge or revised handoff bypasses consent. ORD-03, CAT-03, D03.

## 4. Settlement and expiry

- [x] 4.1 Implement owned, validated private proof registration and restricted merchant reads; create a durable expiry intent and guarded reconciliation-only path for late proof. Race proof registration with expiry, verify orphan recovery and prevent foreign access. PAY-01, D04–D05.
- [x] 4.2 Implement verified receipt posting and distinguish evidence rejection, verified shortfall, supplement, terminal rejection and reconciliation. Enforce exact total and feasibility. Test duplicates, partial/excess funds and merchant-infeasible settlement. PAY-02, D04.
- [x] 4.3 Implement atomic Cash pickup/receipt, no-show and guarded customer/merchant cancellation. Require no-transfer confirmation and reject conflicting evidence under lock. Verify Cash rules, proof/cancel race, sent/uncertain WhatsApp handoff and used/unused capacity. PAY-03–04, DEC-022, D04.
- [x] 4.4 Implement per-receipt full-refund obligations, reservation, uncertain/non-payout resolution and verified posting. Test merchant inability, replay, concurrent over-refund attempts and recovery after a lost response. PAY-04, D04.
- [x] 4.5 Implement fenced, revisioned deadline work for initial and top-up expiry. Verify missed lease, duplicate job, delayed worker, retry without extending the cutoff and exactly-once capacity release against PostgreSQL. PAY-01–02, OPS-02, D05.
- [x] 4.6 Implement the issued 30-minute top-up request, amount/deadline projection, durable notice intent and current-window proof classification. Verify pre-cutoff proof holds through review, exact-cutoff proof and delayed-worker late funds only reconcile, and request or notice replay preserves the deadline. PAY-02, DEC-025, D04–D05.

## 5. Web journeys and merchant operations

- [x] 5.1 Build Gather Dessert customer sign-in, catalogue, cart, review, fee consent, proof and tracking pages. Verify keyboard/narrow viewport use, contrast, logout and reload recovery, full captured checkout, top-up deadline/review and external WhatsApp action without cancellation for sent/uncertain transfers. CUS-01–03, CAT-01–02/05, ORD-01–03, PAY-01–04, OPS-03, D01–D04.
- [x] 5.2 Build merchant catalogue/gallery and calendar previews, scoped work, order, proof, top-up, reconciliation and refund panels. Verify typed drill-down, bounded queries, safe confirmation, stale updates, outcome visibility, accessible controls and customer-role denial. CAT-01–05, ORD-02–03, PAY-01–04, OPS-01–03, D01–D05.
- [x] 5.3 Verify role-scoped server projections, audit evidence and privacy-safe telemetry. Confirm no tokens, contact information, proofs or credentials in diagnostic output; verify safe correlation and merchant follow-up. OPS-02, D05.

## 6. Integrated evidence and handoff

- [ ] 6.1 Execute approved Test Analysis across unit/component, PostgreSQL, provider/consumer contract and UI/system suites. Cover all capability scenarios, UAT-001–014/016 as applicable to standard orders and the scoped top-up notice from UAT-020. Verify browser, security and synthetic performance targets against the reviewed SD. Record case, revision, environment, exact result and exclusions.
- [ ] 6.2 Rehearse migration, worker recovery and proof/ledger/allocation reconciliation in isolated test environments. Record restore and failure evidence separately from commercial launch approvals. D01, D04–D05.
- [x] 6.3 Review clean-code boundaries, names, nullability and side effects. Document only non-obvious transaction, access and recovery invariants. Run scoped regression and record residual gaps for convergence; preserve unchecked tasks whose evidence is missing.

## 7. SD 0.5 runtime migration

- [x] 7.1 Synchronize the runtime decisions in System Design and OpenSpec. Preserve SA 1.2, HTTP contract 0.4.0 and PostgreSQL migration history. Validate both changes in strict mode.
- [x] 7.2 Port existing identity, recovery, cart, catalogue/gallery, capacity/calendar and checkout/owned order behavior to FastAPI and DDD modules, including SQL concurrency and synthetic adapters.
- [x] 7.3 Port the implemented initial proof-expiry worker, including leases, revision checks, retries, duplicate execution and atomic hold release.
- [x] 7.4 Switch the same-origin web relay and server-rendered reads to FastAPI. Re-run the reference suites and equivalent Python verification on PostgreSQL. Record remaining Increment 1 feature work separately.
