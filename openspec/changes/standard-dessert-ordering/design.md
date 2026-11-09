## Context

Greenfield first increment. [Proposal](proposal.md) owns scope. [SD 0.4 Index](../../../output/SD/SD-SweetCommerce-index.md#review-and-approval) records scoped approval for F01–F04, required standard-order F08 controls, verification and the narrow top-up notice. The wider commercial SD also covers [increment 2](../dessert-table-service/proposal.md). An existing TypeScript implementation and PostgreSQL tests establish the migration baseline. The owner-directed runtime decision is recorded in SD 0.5.

## Goals / Non-Goals

**Goals:** deliver a role-separated customer storefront and merchant portal, one authoritative standard order lifecycle, production guardrails, independent fund verification and auditable operator recovery.

**Non-Goals:** event services, sales reports, full commercial milestone delivery, production integration, deployment and archive. See the proposal for release exclusions.

## Decisions

### D01 Modular application and contract conformance

Trace DES-01–06 to [Backend SD](../../../output/SD/SD-SweetCommerce-backend.md). Next.js/React/TypeScript serves both web surfaces and forwards same-origin calls to a private Python 3.12/FastAPI API. A separate Python worker shares the backend application and domain code. Organize business capabilities by interface, application, domain and infrastructure; keep PostgreSQL 16 and the original schema and migration ledger. Verify HTTP, storage, clock, concurrency and lease behavior against the implemented baseline before switching. Pin supported versions at implementation. Select production host, channels and storage provider at the launch gate. Use deterministic adapters and synthetic data for development and tests.

Use the approved first-increment operations and projections in [OpenAPI 0.4.0](../../../output/SD/contracts/sweetcommerce-v1.0.4.openapi.json). The [Integration SD](../../../output/SD/SD-SweetCommerce-integration.md) owns contract semantics. Keep status, availability, permissions and settlement decisions server-owned. The [Frontend SD](../../../output/SD/SD-SweetCommerce-frontend.md) specifies distinct customer and merchant routes and loading, empty, stale, forbidden, pending, failure and next-action states. Verify contrast using the Gather Dessert visual reference.

### D02 Identity, cart and protected resources

CUS-01–03, OPS-01. Use role-bound OTP challenges, encrypted temporary phone binding, atomic single use, server-owned session, same-origin Secure HttpOnly cookies, CSRF checks and deny-by-default object access. Bind admin recovery to the enrolled channel and reset epoch. A successful reset revokes old sessions and invalidates older challenges. Keep all-channel loss in the restricted manual process pending launch approval. Store cart state by account with versioned writes. Snapshot line generations at review and consume matching accepted quantities once. An archived variant may remain in historical records.

### D03 Eligibility, commitment and safe replay

CAT-01–05, ORD-01–03. Convert to MYT for date decisions and store commitments as instants. Bind checkout contact, address or pickup point, flavour, price, terms, handoff and cart version. Review does not allocate. Submit and abandon serialize on the same review and unique order link. Checkout reload keeps opaque review/key references only. Owned order reads return the immutable accepted snapshot. Follow Integration SD for scoped idempotency, stale state and problem codes.

On commitment, use the ordered date lock and check day and product limits together. Capacity-change preview binds the exact edit and date revision, including pending affected orders. A closure preserves current commitments. Stage product-scoped media separately from private proofs, use a versioned ordered-gallery save, and expose only eligible saved images. Use the reviewed media limits in the Integration SD. For merchant delivery, retain each serviceable versioned fee/time offer and require exact customer consent before reserving. Cash waits for merchant acceptance. Track driver arrival separately from handoff and support consented redelivery or reschedule. Preserve used units across remake generations, roll back failed reallocation and record consent before a separate charge.

### D04 Proof, settlement and refund

PAY-01–04. For primary DuitNow payments, register fully validated private proof using the database wall clock under parent/charge locks. Schedule expiry in the same consistency boundary, with request-time guards even when the worker lags. Timely registration keeps the hold. Untimely evidence for an owned closed charge becomes a reconciliation case and cannot restore capacity. Keep object upload outside the transaction; link only durable, validated objects and reconcile orphan candidates.

Record independently verified movements once by unique reference. Under DEC-025, issuing a top-up notice against a verified shortfall and active hold commits the outstanding amount, server issuance time, 30-minute deadline and durable notice and expiry work. Proof registered before the current cutoff preserves the hold through review. At or after cutoff, only qualifying timely proof allows acceptance even if the worker is delayed. An exact net verified total and current feasibility are both required. Release unused units after unsuccessful expiry or adjudication, preserving funds for reconciliation. Retries keep the original deadline. Cash collection and actual pickup commit together.

Under DEC-022, customer cancellation requires `noTransferSent: true`, current version and server-side eligibility under the same locks used for proof registration. If sent or uncertain, display the configured external WhatsApp contact and preserve state. If the merchant cannot fulfil, create per-receipt remaining full-refund obligations atomically. Reserve each payout, keep uncertainty reserved and resolve it only by verified non-payout or confirmed payout. Audit authorized actions and retain used capacity.

### D05 Durable work, evidence and operator recovery

OPS-02, PAY-01–02. Use PostgreSQL due work for initial proof and top-up deadlines, and commit the top-up notice intent with the request. Schedule revisioned, deterministic work with the owning mutation. Use bounded fenced leases and recheck state and time under the parent/charge lock. Project standard orders, fees, payments, reconciliation and refunds into bounded merchant work. Keep audit fields scoped and correlate events with opaque IDs. Exclude OTP, tokens, contact, proof and provider payloads from telemetry. Keep failed/unknown delivery or worker outcomes visible for authorized follow-up.

## Contract operations and task ownership

Operation IDs below refer to the approved increment 1 contract subset. The standard subset of shared operations belongs to this increment. Event-specific categories and work views are added in increment 2.

| Operation IDs | Requirement and verifying tasks |
| --- | --- |
| `startCustomerChallenge`, `verifyCustomerChallenge`, `getSession`, `logoutSession`, `startAdminSession`, `startAdminChallenge` | CUS-01, OPS-01 · 2.1, 5.1–5.3 |
| `getCart`, `setCartQuantity` | CUS-02–03 · 2.2, 3.3, 5.1 |
| `listCatalog`, `getListedProduct`, `listMerchantProducts`, `getMerchantProduct`, `createProduct`, `updateProduct` | CAT-01 · 2.3, 5.1–5.2 |
| `uploadProductPhoto`, `getMerchantProductPhoto`, `getListedProductPhoto` | CAT-05 · 2.3, 5.1–5.2 |
| `evaluateAvailability`, `getCapacityCalendar`, `getOperatingPolicy`, `updateOperatingPolicy`, `previewCapacityImpact`, `configureCapacity` | CAT-02–04 · 2.4, 3.2, 5.2 |
| `reviewCheckout`, `submitOrder`, `getOwnCommandOutcome`, `getCheckoutOutcome`, `abandonOrResolveCheckout` | ORD-01 · 3.1, 5.1 |
| `listOwnOrders`, `getOwnOrder`, `getMerchantOrder`, `changeStandardOrder` | ORD-01, ORD-03, PAY-03–04 · 3.1, 3.3, 4.3, 5.1–5.2 |
| `quoteDeliveryFee`, `confirmDeliveryFee`, `rescheduleStandardOrder`, `createDeliveryAdjustment` | ORD-02–03 · 3.2, 3.4, 5.1–5.2 |
| `submitChargeProof`, `listPaymentProofs`, `getPaymentProofContent`, `getChargeForReview` | PAY-01–02 · 4.1, 4.5–4.6, 5.1–5.2 |
| `confirmReceipt`, `rejectProof`, `openSettlementCase`, `resolveSettlementCase` | PAY-02, OPS-02 · 4.2, 4.6, 5.2 |
| `cancelOwnOrder`, `reserveRefund`, `recordRefund`, `reconcileRefundIntent` | PAY-04 · 4.3–4.4, 5.1–5.2 |
| `listMerchantWork` | OPS-02 · 5.2–5.3 |

## Risks / Trade-offs

| Risk | Mitigation and proof obligation |
| --- | --- |
| Stale cart/quote, unknown write response or last-unit contention | Versioned checkout plus durable order link, owned outcome/abandon, real database concurrency and replay tests |
| Proof bytes persisted without business row | Private immutable storage, explicit bounded cleanup, test upload interruption and reference reconciliation |
| Unverifiable transfer or ambiguous manual payout | Record evidence separately, verified immutable movements, guarded case/refund states and no automatic reopen or second payout |
| Worker unavailable or stale lease | Authoritative request-time deadline checks, persisted work, fenced completion and restart/reconciliation tests |
| Same-origin storefront/admin cross-role access | Server role and owner checks, CSRF, restrictive script policy and tests for foreign orders, proof and merchant actions |

## Migration Plan

Start with the affected first-increment subset of [database design](../../../output/SD/database/data-dictionary.md), its proposed DDL, DML catalog and transaction matrix. Exclude event-specific tables and operations unless a shared schema dependency is required and supported by the approved design. Validate clean bootstrap, stable keys and constrained queries in an isolated PostgreSQL 16 database. Rehearse additive migration and compatible rollback/roll-forward, and verify order, hold, receipt and proof-reference reconciliation. No historical data to backfill was found.

## Verification Approach

Map each scenario to a Test Analysis case before Apply. Unit/component tests cover OTP, deadlines, state guards and presentation. PostgreSQL tests cover real contention, expiry, replay, money and recovery. Contract tests cover both role-based consumers and the server. UI/system scenarios cover three handoff paths, cross-device access and merchant work. Use synthetic data, fake time and sandbox adapters. Verify the approved browser matrix, proof access controls, and the synthetic workload with deadline jobs running. Treat the candidate OTP limits and smoke-test numbers in Backend SD §5 as review inputs, with browser, security and performance evidence captured against the approved targets. Production terms, provider validation, retention, recovery targets and real payment evidence remain launch gates.

## Open Questions

DEC-022 and DEC-025 settle cancellation and top-up. The first-increment approval includes the photo workflow, media limits, OTP controls, and the design's synthetic browser/performance verification baseline. The loss-of-all-channels procedure, privacy request handling and production configuration remain launch decisions. The [Test Analysis](test-analysis.md) maps verification to tasks. Apply requires explicit authorization.
