# SweetCommerce Backend System Design

Revision 0.5 runtime migration design, 9 November 2026. Scope F01–F08. [Index](SD-SweetCommerce-index.md) owns status. [SA](../SA/SA-SweetCommerce.md) governs logic and [Integration](SD-SweetCommerce-integration.md) governs public semantics. [SA-01](../SA/diagrams/SA-01.puml) shows the prior manual process.

## 1. Architecture and ownership

[SD-A01 Architecture and trust](diagrams/SD-A01.puml) · [SD-A02 Checkout runtime](diagrams/SD-A02.puml) · [SD-A03 Deployment and middleware](diagrams/SD-A03.puml)

| Decision | Proposed realization and consequence |
| --- | --- |
| DES-01 Runtime | Next.js App Router with React and TypeScript serves the customer storefront and merchant portal. A private Python 3.12/FastAPI API and an independently supervised Python worker share the backend package and PostgreSQL 16 schema, with separate role pools and process budgets. Pin dependencies in the implementation. Production hosting remains a launch decision. |
| DES-02 Composition | Organize each business capability by interface, application, domain and infrastructure. HTTP and worker adapters invoke use cases; use cases coordinate domain policy, repository/provider ports and the transaction boundary. Domain rules use Python types without framework or database imports. Infrastructure implements SQL and provider adapters. Cross-capability invariants share an explicit PostgreSQL transaction. |
| DES-03 Domain ownership | Identity owns account/session/OTP. Cart owns cart and one-time consumption. Catalogue owns sellability and variants. Capacity owns day/product allocations. Order owns price, fee and fulfilment snapshots. Event owns quote, window and equipment. Settlement owns proof, charge and ledger. Operations derives reports, while Notification owns delivery attempts. |
| DES-04 Persistence | PostgreSQL 16 is proposed for transactions, uniqueness and durable work. Private encrypted object storage holds proof bytes. No independent broker, cache or search engine in v1. |
| DES-05 Access | Authentication derives a principal. Owner filtering and administrator authorization run in every use case and repository boundary that reads or writes private resources. Adapters do not decide business eligibility. |
| DES-06 Work | Commit deterministic work and business effects together. The worker rechecks authoritative state, timestamp and revision under the owning transaction. A provider timeout cannot change an order or receipt. |

### Increment 1 migration and cutover

Move the already implemented identity and recovery, persistent cart, catalogue and gallery, capacity and operating calendar, checkout and owned order projection, and initial proof-expiry work. Keep the existing PostgreSQL migration history, immutable snapshots, idempotency records and lease fencing. Stop the old worker before switching runtime entry points; restart the new worker against the same durable jobs. Roll back the API and worker as a pair if a parity gate fails. Capture role/grant, contract, real PostgreSQL concurrency, media, deadline and web bridge evidence before retiring the reference runtime.

## 2. Feature technical logic

| Feature | Target sequence and source | Constraint, effects and recovery | Verification |
| --- | --- | --- | --- |
| F01 OTP and cart version | [SD-F01](diagrams/SD-F01.puml), SA-F01, PRD-01–03 | Identity / Cart. TX-01/02/04 · DML-01/02. Invalid, expired or throttled code, ownership denial, stale cart version. | UAT-007–008, 014, 016 |
| F02 Availability and last-unit allocation | [SD-F02](diagrams/SD-F02.puml), SA-F02, PRD-04–06 | Catalogue / Capacity. TX-03/04 · DML-03/04. Closed date, cap conflict or past cutoff. Reject with no partial allocation. | UAT-001–003, 005–006, 013 |
| F03 Fee consent, checkout and handoff | [SD-F03](diagrams/SD-F03.puml), SA-F03, PRD-07–09 | Order / Fulfilment. TX-04 · DML-05. Stale fee/terms, invalid transition, duplicate or failed handoff. | UAT-004, 007–008, 010–013 |
| F04 Standard proof, expiry and cash | [SD-F04](diagrams/SD-F04.puml), SA-F04, PRD-10–12 | Settlement. TX-04/05/06 · DML-05/06/07. Mismatched money, expiry race, duplicate receipt and refund limit. | UAT-006, 008–010, 013 |
| F05 Manual event quote and version | [SD-F05](diagrams/SD-F05.puml), SA-F05, PRD-13–14 | Event. TX-07 · DML-08. Invalid time, stale quote, resource concern and deadline. | UAT-003, 017–018 |
| F06 Event settlement and equipment closure | [SD-F06](diagrams/SD-F06.puml), SA-F06, PRD-15–17 | Event / Settlement. TX-05/06/07/08 · DML-06–10. Wrong revision, overdue balance, invalid inspection, duplicate extras. | UAT-017–019 |
| F07 Durable notification delivery | [SD-F07](diagrams/SD-F07.puml), SA-F07, PRD-18 | Notification. TX-08 · DML-10. Timeout or failed retry. Business state remains committed. | UAT-020 |
| F08 Merchant work, audit and reporting | [SD-F08](diagrams/SD-F08.puml), SA-F08, PRD-19–20 | Merchant Operations. TX-01–08 · DML-01/11. Role denial, stale edit, bounded filters and incorrect day attribution. | UAT-014–015 |

Technical state views: [SD-S01 order](diagrams/SD-S01.puml), [SD-S02 event](diagrams/SD-S02.puml), [SD-S03 durable work](diagrams/SD-S03.puml). They refine [SA-S01](../SA/diagrams/SA-S01.puml), [SA-S02](../SA/diagrams/SA-S02.puml) and [SA-S03](../SA/diagrams/SA-S03.puml). Allocation and ledger progress stay separate from fulfilment. DEC-020 retains event windows during timely deposit proof review; explicit rejection releases the unused window.

### Detailed operation ownership and guards

| Product detail | Commands and read models | Technical outcome and verification |
| --- | --- | --- |
| FN-ACC-01–02, FN-CART-01–03 | Identity challenge/verify/session/logout; cart projection, versioned line edits and acceptance consumption | Valid role and ownership on each access. Detect replay/throttling and stale writes, account-scoped reads, no capacity effects during cart edits. Verify valid/new device, denied or expired credentials and duplicate acceptance. |
| FN-CAT-01–04 | Create draft, read/edit fields, stage/preview photos, versioned gallery replacement and publication lifecycle. [SD-F02A](diagrams/SD-F02A.puml), [SD-S04](diagrams/SD-S04.puml) | Validate required publishable fields, selected variant/price/lead time, scoped ordered media and safe decoded photo bytes. Keep previous gallery and state on failure. Visibility changes do not alter order snapshots. |
| FN-CAL-01–04 | Weekly operating policy, day/product limits, closure-impact preview, confirm exact edit and atomic final allocation. [SD-F02B](diagrams/SD-F02B.puml) | Reject stale previews or limits below occupied/used quantities. Show affected orders without cancelling them. Recheck MYT cutoffs, preparation and both limits on each commitment. |
| FN-ORD-01–08 | Checkout review/submit/resolve/abandon, role-scoped list/detail, fee offer/consent, progress, incident and consented recovery | Unique reviewed order and stable replay. Validate fulfilment fields and method. Fee consent must precede hold/payment. Keep promised and actual times separate, never change an accepted quote or allocate twice. Verify each handoff and recovery branch. |
| FN-PAY-01–06 | Charge/QR, private proof, due work, receipt/reconciliation/supplement, Cash pickup, cancellation and guarded refund | Time adjudication under lock. Verify actual funds independently, release unused holds only once, reserve refunds and reconcile ambiguous outcomes. Denied/late files cannot silently create a commitment. |
| FN-EVT-01–04 | Owned application, merchant assessment and alternative dates, versioned quote/terms and tentative window | Check event time and lead-time calendar. Assess resource conflicts manually, lock quote/version and schedule changes, avoid duplicate reservations. Verify stale/expired acceptance, release or revised offer. |
| FN-EVT-05–09 | Deposit/balance/extra obligations, effective balance deadlines, guarded merchant cancellation, teardown/equipment and itemized invoice | Keep timely deposit under review; verify before binding. Apply DEC-021 once. Reject malformed inspection or duplicate extras, preserve original balance and separate ledger movements. |
| FN-NOT-01–03 | Owning use case publishes eligible notice intent. Worker dispatch, outcome and merchant follow-up have separate state | Deterministic milestone/recipient keys, safe retry and fallback. Unknown delivery pauses automatic resend absent safe reconciliation. Order, booking and settlement state cannot be changed by send result. |
| FN-ADM-01–03 | Admin purpose-bound OTP/recovery, controlled lost-channel process, typed work targets and audit | [SD-F08A](diagrams/SD-F08A.puml). Valid enrolled channel recovers with old sessions revoked. Manual verified reset is an operational boundary. Unknown identity or failed recovery issues no session and does not revoke valid sessions. |
| FN-ADM-04–07 | Report filters and date/category aggregation, KPI outputs, operating configuration and launch verification | Count production by local fulfilment day, net movement by actual receipt/refund, and quote conversion by cohort. Validate separation and source reconciliation. Real merchant data, privacy handling and restore proof are launch gates. |

### Transactional clarifications from BRD reconciliation

- Bind an encrypted, short-lived normalized phone to the customer OTP challenge, separate from the rate-limit fingerprint. Verify role and exact challenge under lock, consume once, resolve the account by that phone and clear the binding; expire unused challenges under the approved short-lived policy.
- Checkout stores the reviewed contact/address or pickup point and immutable flavour/price/terms. A fee proposal has its own revision, terms, time and amount; only customer consent makes it the accepted promise. Persist driver arrival and handoff separately. Recovery references the prior agreement and preserves the previous promise if it cannot commit.
- Rejecting an evidence file does not reject an order or prove no funds were sent. Explicit order rejection releases unused capacity. Verified funds when fulfilment is infeasible post once into a distinct case and require a feasible consented reschedule or refund. Merchant-inability cancellation atomically records remaining full-refund obligations per verified receipt and uses existing payout intents. Retain used capacity.
- DEC-025: issue the merchant's top-up notice with the outstanding amount and a 30-minute deadline in one transaction. The deadline is anchored to the recorded notice issuance, independently of outbound delivery retries. Only an order with an active hold and an independently verified shortfall may enter this window. Timely top-up proof retains the hold through review. At expiry, when there is no qualifying proof in review and the order has not been accepted, release unused capacity and leave verified or later funds in reconciliation. Replays and notice resends preserve the original deadline.
- DEC-026: determine timeliness from the event's current effective balance cutoff. While timely proof is awaiting review, keep the slot and block overdue cancellation. After the cutoff, nonpayment cancellation needs merchant confirmation of no balance funds, no timely proof still under review and no recorded balance receipt or unresolved evidence of funds. Mismatched or uncertain funds go to reconciliation. Merchant inability is a separate full-refund path.
- DEC-027: on consented reschedule, a settled original balance stays paid. Validate the consented MYT due time on the new event date minus three calendar days and set grace end to due plus 24 hours. The due instant must still be in the future at commit. An invalid window leaves the case and prior commitments intact for another date or refund. The valid swap persists one new deadline revision and replacement notice work.
- DEC-028: the verified event shortfall path uses the current deposit deadline or effective original-balance cutoff. Link each bank-verified movement to the same charge and mismatch case. Issue the remaining amount and existing cutoff only while that cutoff is still ahead. Accept an eligible charge once at exact net verified total with valid evidence, including review of a timely supplement after cutoff. Unresolved shortfall and late or excess funds enter manual reconciliation. The standard top-up timer does not govern event charges.
- DEC-029: validate event quotes at a minimum of two sen before quote or window writes. Compute the deposit as integer half rounded up and the balance as the remainder. Both are positive. The API and database enforce the same minimum and split.
- DEC-022–024: Customer cancellation requires confirmation of no transfer. Under the parent/charge lock, reject recorded proof, receipts, or other unresolved transfer evidence, along with ineligible states. For standard orders with sent or uncertain funds, use the external WhatsApp follow-up. An accepted event quote awaiting deposit is eligible before transfer. Block customer-requested event cancellation and any customer-initiated refund after transfer, including through merchant actions. Keep the merchant-inability full-refund path separate. A manual transfer is outside the system; later evidence on a cancelled charge opens reconciliation without reopening commitments.
- Event alternate schedule has no commitment; issuance records a customer schedule and a restricted resource assessment. Store first successful booking time once, after verified deposit and feasible commitment. Merchant reads equipment-out and inspection quantities. Consented reschedule locks current event/window and new resources and stores a new effective schedule and reason, preserving original booking time, quote and posted ledger. Infeasible DEC-021 settlement case resolves only after valid agreed reschedule or documented refund.

## 3. Data and persistence

- Conceptual ownership: [SA-D01](../SA/diagrams/SA-D01.puml). Physical relationships: [SD-D01](diagrams/SD-D01.puml).
- [Data dictionary and access paths](database/data-dictionary.md), [proposed PostgreSQL DDL](database/schema.sql), [parameterized DML](database/dml-catalog.md), [transaction/concurrency matrix](database/transaction-concurrency-matrix.md), [migration and recovery](database/migration-recovery.md).
- Accept cart intent only against an owned, open, unexpired checkout review and current versions. Submit and abandonment share its lock and exactly one order links to the review. Persist the order number, price/fee/terms and local date atomically. Rescheduling records consent before changing promise and preserves original capacity on failure.
- Merchant-assessed event windows are recorded, consulted during quote issuance and released by guarded expiry/cancellation. v1 does not automatically schedule staff or equipment. Merchant adjusts standard kitchen capacity as needed.
- Manual bank receipt evidence never posts money by itself. Immutable confirmed money movements drive reports. Late evidence queues a case without altering terminal order or capacity. Actual funds are posted against the case or returned through an existing refund intent. A reserved refund cannot be paid twice; uncertain payout stays in reconciliation, and confirmed non-payout releases it.

## 4. Middleware and failure recovery

| ID | Dependency and scope | Consistency, failure, security and operations |
| --- | --- | --- |
| MW-01 | PostgreSQL 16, F01–F08, web and worker pools | Source of truth. Explicit locks and bounded pools. Reject unsafe writes on DB failure. Encrypted connections/backups and least-privilege roles. Measure pool saturation, transaction time, deadlocks, active allocations and restore reconciliation. |
| MW-02 | PostgreSQL-backed work and scheduler, F02–F07 | Durable intent plus due time, versioned payload, fencing lease and stable event key. Reclaim abandoned leases. Exact state/clock checks at commit. Quarantine terminal/unknown delivery, replay only after reconciliation. Monitor lag, expired leases, retry and dead counts. |
| MW-03 | Private object storage, F02/F04/F06 | Use separate scoped prefixes and policies for catalogue media and payment evidence. Validate complete bytes before immutable storage. Catalogue media uses authorized preview or listed-gallery reads, proof stays restricted. Detached, expired staging or unlinked objects enter bounded cleanup; protect active references. Reconcile metadata after restore. |
| MW-04 | OTP and business notification adapters, F01/F07/F08 | Short deadline and redacted outcome. No session on failed verification. Delay or flag notice without changing business status. Verify sender, retry/dedupe, quota and fallback before launch. |
| N/A | Redis/cache service, broker, search and separate routing service | No approved workload or v1 behavior requires them. Database handles the consistency boundary and the small operational work queue. |

## 5. Security, resilience and performance

| Concern | Draft controls and evidence |
| --- | --- |
| Customer/admin isolation | Secure HttpOnly opaque cookie, same-origin and CSRF guard, revocation, separate role-scoped challenges and admin enrollment. Propose five-minute OTP TTL, five verification attempts and three sends per destination per 15 minutes, with source/global abuse budgets. Verify deny-by-default and concurrent replay. |
| Evidence and data | Allowlisted JPEG, PNG and PDF with signature checks, 5 MiB max, private immutable storage, attachment download, no active inline rendering. Reject unscannable or invalid objects. Managed encryption, scoped secret injection, rotation, backup and controlled restore. Technical owner and production key/provider selection at launch gate. |
| Financial audit | Confirm actual funds, bind exact proof/charge/quote, recent admin verification for sensitive operations, parameterized SQL, typed failures and one audit fact per accepted action. Audit proof reads and financial changes with actor, opaque IDs, action and reason code. |
| Failures | Short pool/transaction budget; retry at most twice for safe aborted transient database transactions with jitter. Never retry an ambiguous provider send without provider dedupe or reconciliation. Surface closure and stale-version conflicts for user refresh. |
| Synthetic smoke | Proposed 30 minutes at 20 requests/s with expiry work active. p95 ≤500 ms read and ≤1 s commitment, unexpected failures <1%, p95 expiry processing lag ≤60 s and zero invariant failures. Targets are test assumptions, not launch commitments. |

## 6. Release and operation

Promote immutable build digest, migrate additively, run synthetic checks, deploy web/worker with bounded drain, validate mixed contract/job versions and roll back compatible artifacts or repair forward. Configuration is validated at startup with safe defaults for test, then versioned environment config and scoped secret references. Synthetic channels and accounts only until launch approval.

Use structured logs with feature, action, outcome, release and opaque request/work IDs; no OTP, cookie, contact, address, proof or raw provider bodies. Keep restricted audit separate. Trace HTTP, transaction, object finalization and asynchronous attempt boundaries. Alert on prolonged expiry/review lag, failed dispatch, absent proof, DB pool saturation and reconciliation mismatches. Runbooks pause affected work, reconcile receipts and holds, restore in isolation and obtain a merchant decision before resending. Real support/escalation ownership, backup cadence, retention, RPO and RTO require launch confirmation.

## 7. Verification handoff

Run component policy checks plus concurrent PostgreSQL tests, contract/error checks, admin and owner isolation, proof storage interruption, refund reservation and ledger reconciliation, expiry boundaries, provider failure/replay, mixed-version release and backup/restore. Use BRD UAT mappings above. This is a proposed design; SQL, scenarios and production recovery are unexecuted.

| Test layer | Risk owner and evidence target |
| --- | --- |
| Unit/component | Backend and frontend owners verify guarded states, local-time boundaries, errors, form recovery, focus and next action. Fixed clocks and synthetic terms only. |
| Integration/contract | Backend and integration owners use isolated PostgreSQL, private storage substitute and deterministic channel adapters. Verify real transactions, contention, typed failure, schema, version and replay. Run against a clean database per suite. |
| System, non-functional and UAT | Engineering runs browser, security denial, recovery and smoke tests in staging-like isolated environments with synthetic data. zwong owns merchant acceptance and actual channel/payment policy validation before release. |

Record revision, case ID, command, environment, first result, any retry, expected/actual and cleanup. Fix flaky scenarios or quarantine with an owner, expiry and restoration criterion. Any failed critical invariant or missing mandatory evidence blocks release.
