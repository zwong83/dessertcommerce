## Context

**Increment 2 implementation design.** This delta maps the signed business rules and DEC-027–029 to PRD/SA 1.2 and SD 0.5. The [source baseline](proposal.md#source-baseline-and-readiness) records approval status. The [SD Index](../../../output/SD/SD-SweetCommerce-index.md) owns readiness and the [OpenAPI 0.4.1](../../../output/SD/contracts/sweetcommerce-v1.0.4.1.openapi.json) owns request and response shapes. The [Backend](../../../output/SD/SD-SweetCommerce-backend.md), [Frontend](../../../output/SD/SD-SweetCommerce-frontend.md) and [Integration](../../../output/SD/SD-SweetCommerce-integration.md) define module boundaries, UI and guards.

The system is greenfield. Increment 1 supplies the customer and dedicated merchant shells, standard facts and capacity controls, shared Settlement, security, audit and durable-work foundations. The candidate contract describes one API with 61 operations. Increment 2 owns 12 new operation IDs. Shared operation IDs stay in Increment 1's 49-operation baseline and gain only the event or commercial behavior described below.

## Goals / Non-Goals

- Deliver an owned request-to-closure flow with explicit merchant decisions, observable settlement state, and one durable effect for each eligible action.
- Extend shared views and work dispatch with event and commercial data while preserving standard ownership. Event planning remains manual and reuses the standard capacity review and adjustment flow.
- Keep scope within the candidate's single-merchant Next.js web, FastAPI, Python worker and PostgreSQL design. Provider selection, business launch configuration, automatic scheduling, separate infrastructure and advanced reporting sit outside this delta.

## Decisions

These are mappings of candidate SD decisions. Material choices and contract corrections go back to the governing source for approval.

| Decision | Mapping, rationale and trade-off | Constraints and evidence |
| --- | --- | --- |
| DTS-D01 · Domain and role composition | Inherit DES-01–05 and SA-DEC-01–03. Route customer and merchant commands through existing owner/role-guarded application services. Event owns application, quote, window, schedule and equipment. Settlement owns charges, proof, cases and ledger. Capacity owns standard day/product limits. Separate event and order checkouts preserve the signed journey boundaries. | Reuse one candidate Next.js web artifact and independently supervised worker, PostgreSQL 16 and private evidence storage. Keep account/role-scoped in-memory query state and draft forms, clear private state on sign-out, and retain only opaque intent identifiers for recovery. Reuse same-origin, Secure HttpOnly session and CSRF controls. Verify 401/403, foreign 404, actor-scoped replay and redacted audit. DTS-APP-01, DTS-PAY-06, DTS-RPT-01. |
| DTS-D02 · Manual quote and shared schedule | Inherit SD-F05, SD-S02, SD-UI05 and TX-07/DML-08. Persist owner plus intent and canonical digest on the event. Merchant assesses standard demand and active event windows. Serialize issuance, unaccepted supersession and applicable release against the current event/version and schedule. A manually assessed window records an operator decision. Automatic allocation of staff, travel or kitchen units is outside scope. | Use the candidate calendar's event window projection and existing versioned capacity controls. Persist schedule, assessment and current quote snapshot together. Separate requested, proposed, quoted and effective dates. Accept the exact live quote/terms using quoted decimal `If-Match` and idempotency. Verify boundary clock, stale quote, overlap review and atomic release. DTS-APP-01–03, DTS-PAY-01. |
| DTS-D03 · Proof, clocks and independent settlement | Inherit DES-03/04/06, SD-F06, SD-UI06 and TX-05/06/DML-06/07. Persist validated evidence privately, then adjudicate receipt time with the database wall clock under parent/charge locks. File arrival and merchant verification are independent facts. Eligibility and cutoff follow the current quote/charge or balance deadline revision. A late valid upload preserves reconciliation evidence. | Bind proof, receipt and refund to exact charge, quote when applicable and bank reference. Use bound SQL and immutable verified movements. Preserve timely deposit and balance review across cutoff. Check ordinary due/grace, DEC-021 feasible 24-hour replacement without extra grace, infeasible verified case, and proof at exact cutoff. No worker cancels for balance nonpayment. DTS-PAY-01–03/06. |
| DTS-D04 · Event disposition and refunds | Inherit SD-F06/SD-S02, TX-06/07, DML-09/16 and the Integration event recovery rules. Separate free pre-transfer cancellation, merchant overdue nonpayment, merchant inability and force majeure. Use event/charge locks for proof, money and cancellation. For consented reschedule, atomically swap only unused windows, bind the balance plan and retain original terms and ledger. Merchant policy and consent determine disputed dispositions. | Reject customer requests after transfer and preserve the distinct merchant-inability full-refund path. Reserve refundable amount before a manual payout; uncertain stays reserved and only independently verified payout posts. An outstanding reschedule requires approved due/grace, new revision and replacement reminder. Preserve first booked time if already set. Verify stale jobs, incomplete consent, failed reallocation, post-payment requests and payout contention. DTS-PAY-03–06. |
| DTS-D05 · Service and extras | Inherit SD-F06/SD-S02/SD-UI06, TX-07 and DML-09. Store actual setup/end/teardown separately from planned times. Equipment is keyed to the event's saved identities. Enforce `returned + lost = taken` and `damaged <= returned` when inspected. Itemized extras use a distinct charge and ledger category with due time from actual end. | Keep merchant inspection history and customer-safe arrangements. Use current event revision and guarded phases. No equipment deposit. Verify saved equipment reload, no-extra completion, invalid/stale inspections, duplicate invoices and extra-charge confirmation. DTS-SVC-01–02. |
| DTS-D06 · Durable notice delivery | Inherit DES-06, MW-02/04, SD-F07, SD-UI07, TX-08 and DML-10. Commit permitted milestone intent with the business fact. Reuse first-increment top-up intent and customer-visible request/status as a source when routed through the shared channel. Dispatch outside the transaction via a fenced lease. The attempt outcome belongs to Notification. | Derive deterministic keys from source/milestone/revision or movement and recipient. Recheck authoritative state for delayed work. Use configured channels with five-second candidate send deadline and up to three safe retries near 1, 5 and 15 minutes with jitter. Unknown outcome is quarantined absent safe dedupe or reconciliation. Resolution records manual contact or verified provider disposition. DTS-NOT-01–02. |
| DTS-D07 · Commercial read models | Inherit SD-F08/SD-UI08 and DML-11. Extend typed merchant work and derive reporting from committed acceptance, booking, prep and ledger facts. Use a bounded query and explicit date basis. Compute the off-platform input ratio in the report view per Frontend SD. | Restrict merchant reads, avoid per-row requests, paginate with stable time/ID anchors (default 25, max 100) and validate filters/cursors. Calendar ranges are at most 31 inclusive MYT days and reports 92. Use half-open UTC boundaries for inclusive MYT dates. Verify category/status isolation, original quote cohorts and actual money movements across local midnight. DTS-RPT-01–03. |

DEC-027 constrains DTS-D04. An outstanding balance on a consented reschedule uses a future due instant on the new MYT date minus three days and exactly 24 hours' grace. An invalid window leaves prior commitments intact for another date or refund. Paid balance stays paid. Atomically update resources and deadline revision only for an eligible reschedule.

DEC-028 constrains DTS-D03 and DTS-D06. Use the same event charge, open mismatch case, unique receipt references and existing cutoff. Before cutoff, issue a notice for the verified outstanding amount and that deadline. A timely supplement remains eligible for review after cutoff. An unresolved shortfall goes to manual reconciliation without a new timer. Standard top-up remains governed by DEC-025.

DEC-029 constrains DTS-D02. Require two sen or more before quote or resource mutation. Calculate the deposit as rounded-up whole-sen half and the balance as the positive remainder. Enforce the same boundary in OpenAPI, PostgreSQL and the merchant editor.

### Contract operation ownership

Paths below are relative to `/api/v1`. Every new ID has an implementation and contract evidence task. Shared handlers and common command semantics come from the Increment 1 baseline. Event-specific guards, projections and fixtures are Increment 2.

| Increment 2 operation ID | Method and path | Requirement and tasks |
| --- | --- | --- |
| `submitEventRequest` | POST `/events` | DTS-APP-01 · 2.1, 2.5 |
| `listOwnEvents` | GET `/events` | DTS-APP-01 · 2.1, 2.5 |
| `getOwnEvent` | GET `/events/{eventId}` | DTS-APP-01/03, DTS-PAY-01–05, DTS-SVC-01–02 · 2.1, 2.5, 3.7, 4.3 |
| `acceptEventQuote` | POST `/events/{eventId}/accept-quote` | DTS-APP-03, DTS-PAY-01 · 2.4, 2.5 |
| `cancelEventRequest` | POST `/events/{eventId}/cancel` | DTS-PAY-04 · 3.4, 3.7 |
| `getMerchantEvent` | GET `/admin/events/{eventId}` | DTS-APP-02/03, DTS-PAY-01–05, DTS-SVC-01–02, DTS-RPT-01 · 2.2, 2.5, 3.7, 4.3, 6.1 |
| `issueEventQuote` | POST `/admin/events/{eventId}/quotes` | DTS-APP-02/03, DTS-PAY-01 · 2.3, 2.5 |
| `changeEventBooking` | POST `/admin/events/{eventId}/actions` | DTS-APP-02 alternate/decline · 2.2. DTS-PAY-03/04/05 cancellation · 3.3, 3.4, 3.6. DTS-SVC-01/02 service/closure · 4.1–4.3. |
| `rescheduleEventBooking` | POST `/admin/events/{eventId}/reschedule` | DTS-PAY-05 · 3.5, 3.7 |
| `getMerchantReport` | GET `/admin/reports` | DTS-RPT-02/03 · 6.2–6.4 |
| `getMerchantNotice` | GET `/admin/notices/{noticeId}` | DTS-NOT-02, DTS-RPT-01 · 5.4, 6.1 |
| `resolveNotificationFailure` | POST `/admin/notices/{noticeId}/resolve` | DTS-NOT-02 · 5.4 |

| Increment 1 operation ID reused or extended | Increment 2 behavior and evidence task |
| --- | --- |
| `getCapacityCalendar`, `previewCapacityImpact`, `configureCapacity` | Extend calendar read with event windows. Use existing standard capacity review/adjustment for manual changes. Retain standard semantics and verify scope and limits in 2.2. |
| `listMerchantWork` | Extend the same work API with event, event proof/exception and notice targets. Verify existing standard target compatibility in 5.4 and 6.1. |
| `submitChargeProof` | Reuse upload/storage and exact charge scope. Add event deposit/balance/extra classification, clock and review guards in 3.1, 3.3, 3.7 and 4.2. |
| `listPaymentProofs`, `getPaymentProofContent`, `getChargeForReview` | Reuse merchant-only review and on-demand attachment read for event charges. Verify event scope and sanitization in 3.1 and 3.7. |
| `confirmReceipt`, `rejectProof`, `openSettlementCase`, `resolveSettlementCase` | Add event dispositions and case guards, independent deposit/balance/extra verification, event supplements using the existing cutoff, explicit deposit rejection versus evidence rejection and DEC-021 case closure. Verify in 3.1–3.3, 3.5–3.8 and 4.2. |
| `reserveRefund`, `recordRefund`, `reconcileRefundIntent` | Apply shared refund intent and posting controls to event receipts, including remaining full-refund obligations. Verify in 3.6 and 3.7. |
| `getOwnCommandOutcome` | Reuse `GET /commands/{key}?operation=…` for supported actor-scoped outcomes. The response is an opaque resource type and ID plus completion time. Resolve the resource through the authorized detail read or replay the same frozen command when needed. Durable event submission intent remains authoritative after short receipt expiry. Verify in 2.1, 2.5 and 3.7. |

Reuse the inherited authenticated read/write handling, typed Problem envelope, per-operation idempotency, version checks and safe retry. Exact request fields and responses are those of the reviewed contract. No second authentication, ledger, proof store or notification worker is required.

### Source, scenario and task crosswalk

The spec headers provide exact scenario anchors. Suffix ranges below are inclusive. This is the draft coverage map for later Test Analysis.

| Source / acceptance | Scenario IDs | Tasks |
| --- | --- | --- |
| PRD-13, FN-EVT-01/04, SA-F05, UAT-003/008/014/017 | DTS-APP-01a–d | 2.1, 2.5 |
| PRD-14, FN-EVT-02/03, BR-CAP-008, SA-F05, UAT-017 | DTS-APP-02a–c | 2.2, 2.3, 2.5 |
| PRD-14/15, FN-EVT-03/04, SA-F05/SA-S02, UAT-017/018 | DTS-APP-03a–c | 2.3–2.5 |
| PRD-15, FN-EVT-03/05, DEC-020/029, SA-F06, UAT-017/018 | DTS-PAY-01a–e | 2.3, 3.1, 3.2, 3.7 |
| PRD-16, FN-EVT-06, DEC-021, SA-F06, UAT-018 | DTS-PAY-02a–d | 3.2, 3.7, 5.2 |
| PRD-16, FN-EVT-06/07, DEC-026, SA-F06, UAT-018 | DTS-PAY-03a–c | 3.3, 3.7, 5.2 |
| PRD-14/16, FN-EVT-04/07, DEC-023/024, SA-S02, UAT-017/018 | DTS-PAY-04a–c | 3.4, 3.7 |
| PRD-16, FN-EVT-07, DEC-021/024/026/027, BRD §10.2, UAT-018 | DTS-PAY-05a–e | 3.5–3.7 |
| BR-PAY-007/008/010–012, FN-EVT-05–09, NFR-003–008, UAT-008/014/017–019 | DTS-PAY-06a–c | 3.1, 3.6, 3.7, 4.2 |
| PRD-15/16, FN-EVT-05/06, DEC-028, UAT-017/018 | DTS-PAY-07a–c | 3.7–3.8, 5.2 |
| PRD-17, FN-EVT-08/09, SA-F06, UAT-019 | DTS-SVC-01a–b, DTS-SVC-02a–c | 4.1–4.3 |
| PRD-18, FN-NOT-01–03, BRD §12, SA-F07, UAT-020 | DTS-NOT-01a–c, DTS-NOT-02a–c | 5.1–5.4 |
| PRD-19, FN-ADM-03, SA-F08, UAT-014/017–020 | DTS-RPT-01a–b | 2.2, 3.7, 5.4, 6.1 |
| PRD-20, FN-ADM-04/05, BO-002/004–006, SA-F08, UAT-015 | DTS-RPT-02a–c, DTS-RPT-03a–b | 6.2–6.4 |

## Risks / Trade-offs

- Manual bank transfers are outside the application. An explicit no-transfer declaration and known evidence guard cancellation. Late evidence follows reconciliation, including after a cancellation race.
- Payment and schedule work can overlap. Use the inherited lock order, current versions, server-side eligibility checks and stable external references. Fail invalid transitions without partial effects. Replays read prior results. Retry aborted safe database transactions within the SD budget.
- Provider timeouts can leave an unknown outcome. Keep it visible in restricted work. Correlate opaque request and work IDs, alert on stale review/expiry, retry/dead work, missing proof references and ledger mismatches, and keep proof/contact/provider payloads out of logs.
- Shared contract and jobs span increments. Check both journey fixtures, stale revisions, lease reclaim and web/worker compatibility on rollout and rollback. Use candidate workload assumptions and browser support only after SD review. Candidate smoke evidence uses 30 minutes at 20 requests/s, p95 read ≤500 ms, commit ≤1 s, expiry lag ≤60 s, unexpected failures <1% and zero invariant failures. Verify keyboard/focus, contrast, responsive layouts and recoverable errors on reviewed mobile and desktop browsers.

## Migration Plan

Use the [database migration and recovery proposal](../../../output/SD/database/migration-recovery.md). Bootstrap in isolation and prove the additive upgrade from the Increment 1 schema with synthetic data. Apply versioned migrations before the compatible web and worker artifacts, verify grants and indexes, check mixed contract and work versions, and perform a bounded worker drain. Preserve event history, open refund intents, receipts and used resources across rollback. Roll back compatible app/worker versions or correct forward. Restore database and private proof objects together in isolation, reconcile ledger totals, windows, references and ambiguous work before reopening writes. Launch configuration and privacy/recovery targets remain owner-controlled.

## Open Questions and Gates

| ID | Source and issue | Impact and decision required | Owner |
| --- | --- | --- | --- |
| DTS-G01 | Owner directed implementation of the remaining work. PRD/SA 1.2, SD 0.5 and OpenAPI 0.4.1 are the build baseline. | Validate the implementation and retain separate merchant launch acceptance. | zwong with design and contract reviewers |
| DTS-G02 | Resolved by DEC-027. | Verify date and grace recalculation and invalid-plan rollback. | Event/Settlement |
| DTS-G03 | Resolved by DEC-028. | Verify independently posted split receipts, original cutoff and manual reconciliation. | Settlement |
| DTS-G04 | Resolved by DEC-029. | Verify API and database reject 0/1 sen and split 2/3 sen into positive instalments. | Interface/Data |
| DTS-G05 | Increment 1 supplies the shared auth, order, proof, settlement and work facilities. | Reconcile shared contract/fixture compatibility and verify foundational facilities before Apply. Draft sync uses the agreed delivery boundary and proceeds independently. | Increment 1 and Increment 2 delivery owners |
| DTS-G06 | BRD §20.3 and SD Index launch register. Actual provider enrolment, verified sender/templates/fallback, terms, bank/refund verification, customer privacy procedures and retention/restore targets are pending. | Use synthetic fixtures for build evidence. Resolve and verify real configuration and policies for commercial launch. | zwong with delivery and operations owners |

DEC-027–029 resolve DTS-G02–G04. [Test Analysis](test-analysis.md) maps the reviewed scenarios to verification. Commercial launch remains a separate gate.
