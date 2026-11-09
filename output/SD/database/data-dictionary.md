# SweetCommerce Physical Data Dictionary and Access Paths

Draft 0.1. [Physical ERD](../diagrams/SD-D01.puml), [DDL](schema.sql), [DML](dml-catalog.md), [transactions](transaction-concurrency-matrix.md). DDL owns SQL types, defaults, nullability and hard constraints. SA-D01 owns the conceptual model.

| Tables / owner | Key fields and invariant | Classification, lifecycle and access |
| --- | --- | --- |
| account, otp_challenge, session / Identity | UUID account, E.164 customer phone, distinct roles, token/CSRF/verifier hashes, UTC expiries | Restricted contact and secrets derivatives. Auth only; expire/revoke challenges and sessions. One customer cart and one provisioned admin |
| product, variant / Catalogue | Product status/version and optional category label, fixed variant/flavour, sen price and integer prep minutes, image reference | Account-visible catalog. Admin writes; archive rows referenced by order snapshots |
| product_media, product_gallery / Catalogue | Product-scoped immutable object ID and lifecycle; ordered attachment with cover at position 1. Composite ownership FK and one position per product | Staged/retired objects are never customer-readable. Serve attached photos only while listed; bounded orphan cleanup by approved storage policy |
| operating_policy / Capacity | Singleton MYT weekly defaults, hours and revision. Approved cutoffs remain read-only in the API | Merchant update affects new promises; current order snapshots survive. Weekly ISO-day uniqueness validated by use case |
| cart, cart_line / Cart | Account PK and variant unique per account. Generation and monotonic cart version | Customer-owned. No age TTL for unpurchased items; delete line on removal, handle account deletion under approved policy |
| capacity_day, capacity_product_limit, capacity_allocation / Capacity | MYT service date, units, indexed active product allocation, used vs released | Merchant restricted. Serialized by day; keep history for reconciliation |
| standard_order, standard_order_line / Standard Ordering | Account FK, unique public number, state/version, local date and UTC deadline, immutable price and address/terms snapshot | Customer-owned plus admin. Personal contact/address protected; retention by signed launch policy |
| checkout_review, order_recovery_agreement / Standard Ordering | Single-use or abandoned review and its unique order link. Versioned consent records with exact revised time or amount | Owned checkout outcome, admin writes agreement. Keep only consent reference and bounded reason, no conversation transcript |
| delivery_fee_offer / Standard Ordering | Immutable offered revision with time, fee and terms; distinct from accepted promise | Owner-scoped current offer; merchant history restricted. Retain with the order's agreed terms policy |
| event_application, event_quote, resource_window, equipment_check / Event | Account FK, local date and instants, versioned quote/terms, minimum two sen and positive whole-sen instalments, resource window and inspection counts | Customer-owned event view, admin-only assessment notes. Retain quote versions and decisions |
| charge, payment_proof, money_entry / Settlement | Parent FK, category, sen, due/received instants, standard top-up issue/deadline instants, content digest/key and immutable bank references | Restricted financial data. Only owner status view and admin review. Attachments private; physical object lifecycle by approved retention |
| settlement_case, refund_intent / Settlement | Proof/charge reconciliation reason and status; reserved amount and verified terminal refund disposition | Admin reconciliation queue. Uncertain refund remains reserved; payout posting is append-only |
| full_refund_obligation / Settlement | One merchant-inability full-refund obligation per verified receipt; open amount derived from posted payouts | Visible to the merchant and summarized for the owner. Record original cause; reconcile through guarded intents |
| event_schedule_change / Event Booking | Agreed schedule, prior quote, recorded consent, replacement resource window and obligation disposition | Original quote/ledger stays unchanged. Merchant notes restricted; customer sees effective schedule |
| command_receipt, audit_event / Platform | Actor + operation + key; request digest and minimal result reference; safe change records | Internal. No raw payment, OTP, address or message body in audit. Retain integrity and minimize identifiers |
| durable_work, notice_attempt / Operations | Deterministic event key, due/lease instants, attempt state | Internal identifiers and sanitized errors; bounded operational retention and controlled replay |
| notice_followup / Operations | One audited terminal follow-up disposition per notice | Restricted merchant use; does not change the originating business state |

| Access path | Representative query/plan to verify |
| --- | --- |
| Owner + creation + UUID | Keyset page for standard/event lists. Return 25 by default, max 100, stable descending ordering |
| Day + product / active index | Read only matching day/product allocation rows under day lock. EXPLAIN with populated synthetic closures and last-unit contention |
| State + due / ready work | Index-bounded next due batch, skip locked; verify expired and already-completed work avoid redelivery |
| Money occurred_at and charge | MYT month/range filtered as UTC instants. Date range limited by contract; compare with known synthetic receipts and refunds |
| Work state + last update | Merchant views paginate; union work kinds with bounded index reads. Benchmark no unbounded sort at agreed fixture size |
| Proof/digest and external reference | Unique dedupe on a charge's uploaded object and globally scoped bank movement; reconcile false matching via merchant queue |

No partitioning is proposed for v1. Obtain real data volume and EXPLAIN evidence before scaling. Retention, backup and permissions belong to the Backend SD and release gate.
