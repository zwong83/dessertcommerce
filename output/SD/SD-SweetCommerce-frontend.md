# SweetCommerce Frontend System Design

Revision 0.5 runtime migration design · [Index](SD-SweetCommerce-index.md) · [Integration](SD-SweetCommerce-integration.md) · [OpenAPI 0.4.0 candidate](contracts/sweetcommerce-v1.0.4.openapi.json). [SD-UI00](diagrams/SD-UI00.puml) shows the two route groups and ownership.

## 1. Surfaces and runtime

| Surface | Routes and layout |
| --- | --- |
| Customer Storefront | /login, /shop, /cart, /checkout, /orders, /orders/:id, /events, /events/new, /events/:id. Shared customer navigation, cart entry and current activity. |
| Merchant Admin Portal | /merchant/login, /merchant/work, /merchant/catalog, /merchant/capacity, /merchant/orders/:id, /merchant/events/:id, /merchant/reports. Shared merchant shell and work queue. |

Use separate authenticated route shells in Next.js App Router. Next forwards same-origin API requests to FastAPI and reads server-rendered projections from the same backend contract. Server layouts establish the session, with client components for interactive forms. Route guards restore only an allowed same-origin deep link. Role and ownership checks belong to the server. Shared components own input, feedback, money, local dates, empty and loading states; feature modules own forms and journeys. Use [Gather Dessert logo and colour reference](../BRD/SweetCommerce/BRD-SweetCommerce.md#41-brand-logo-and-theme-colours) on customer surfaces. Validate contrast for actual combinations. Merchant layouts prioritize dense work lists and explicit status/confirmation.

## 2. Feature flows and states

| Feature | UI flow and route | Components and server behavior | Recovery |
| --- | --- | --- | --- |
| [F01 Sign-in and account cart](diagrams/SD-UI01.puml) | Customer /login, /cart · merchant /merchant/login | OtpForm and CartLines · challenge, verify, session, cart | expired OTP, new-device sign-in or stale cart. Show verification feedback or refetch canonical cart. |
| [F02 Catalogue and calendar](diagrams/SD-UI02.puml) | Customer /shop · merchant /merchant/catalog and /merchant/capacity | ProductList, AvailabilityPicker and CapacityForm · catalog, availability, products, capacity | stale availability or conflict. Refresh choices or preserve unsaved form. |
| [F03 Checkout and fulfilment](diagrams/SD-UI03.puml) | Customer /checkout and /orders/:id · merchant /merchant/orders/:id | Checkout, FeeReview and OrderTimeline · orders, confirm-fee, fee and order actions | fee revision changed or invalid handoff. Show current quote or recovery action. |
| [F04 Standard payment and cash](diagrams/SD-UI04.puml) | Customer /orders/:id · merchant /merchant/orders/:id | ChargePanel, ProofForm and SettlementReview · proof, admin receipts, refunds and Cash actions | deadline expired or verification mismatch. Refresh order and explain merchant follow-up. |
| [F05 Event application and quote](diagrams/SD-UI05.puml) | Customer /events/new and /events/:id · merchant /merchant/events/:id | EventRequestForm, QuoteReview and QuoteEditor · events, quotes and accept-quote | date invalid or quote superseded. Keep draft fields or refresh current quote. |
| [F06 Event payment and inspection](diagrams/SD-UI06.puml) | Customer /events/:id · merchant /merchant/events/:id | InstalmentTimeline, EquipmentChecklist and ExtrasForm · event actions, proof and receipts | grace, incorrect proof or invalid inspection. Show the guarded next action and safe error. |
| [F07 Notification follow-up](diagrams/SD-UI07.puml) | Customer activity · merchant /merchant/work?kind=NOTICE | StatusBanner and NoticeQueue · activity reads, work list and resolve notice | provider uncertain or retries exhausted. Keep authoritative status and show follow-up. |
| [F08 Merchant operations and reporting](diagrams/SD-UI08.puml) | Merchant /merchant/work and /merchant/reports | WorkQueue, AuditHistory and SalesReport · admin work, order or event details and reports | unauthorized or invalid date range. Deny or request a bounded range. |

Loading uses accessible status and skeletons where appropriate. Empty carts and no available handoff show a clear next action. Confirming a new quote/fee shows the versioned amount and terms, then refreshes the canonical status. Merchant sees typed work targets and can open authorized proof bytes on demand. Verified receipt and pending proof are separate UI states. On the event timeline, a timely deposit remains visibly under review and retains the slot after the cutoff.

### Customer storefront screens

| Surface and detail IDs | Actions, states and recovery |
| --- | --- |
| /login · FN-ACC-01–02 | Request, verify, resend, loading, expired/invalid and temporary unavailable; return only to authorized route; logout clears private state. |
| /shop, /shop/:productId, /cart · FN-CAT-04, FN-CART-01–03 | Browse category, photo gallery, variant/price and availability. Add, change, remove, review reference total, reload on cross-device conflict. Empty, unavailable or stale item presents a next action. The saved cart returns after sign-in on a new device. |
| /checkout and /orders/:id · FN-CAL-03–04, FN-ORD-01–08, FN-PAY-01–05 | Select fulfilment/time/contact, show scoped address and exact terms, review and submit, show fee offer before payment, QR/proof and cash pickup instructions, expiry/receipt/cancellation. Capacity failure at commitment returns fresh time options. Recover uncertain submission through the same review. Timeline separates agreed promise, actual status and actionable merchant follow-up. |
| /orders, /events · FN-ORD-07, FN-EVT-04, FN-NOT-01–02 | Bounded owned lists, distinct standard/event tabs, next action and current status; hide records on access denial and offer retry on transient failure. Timeline remains authoritative if external notification is delayed or failed. |
| /events/new and /events/:id · FN-EVT-01, FN-EVT-03–09 | Preserve form on correctable error. Review versioned package, equipment and times, accept quote, handle expired/stale offer, show each payment and effective deadline, view cancellation/arrangement and additional charge. |

### Merchant portal screens

| Surface and detail IDs | Actions, states and recovery |
| --- | --- |
| /merchant/login and /merchant/recover · FN-ADM-01–02 | Dedicated sign-in and recovery using an enrolled verified channel. Safe retry and generic denial. Show controlled support path for loss of all enrolled channels; client cannot reset a contact by supplying a new number. [Recovery sequence](diagrams/SD-F08A.puml). |
| /merchant/catalog, /merchant/catalog/new, /merchant/catalog/:productId · FN-CAT-01–03 | Draft, edit category/variant/flavour/price/lead time, upload on desktop or mobile, show candidate preview and file error, reorder or replace and remove. Explicit save attaches the gallery. Show saving, conflict and field errors without losing unsaved edits. Separate list, unlist, suspend, sold out, resume and archive with confirmation where applicable. [Editor flow](diagrams/SD-F02A.puml). |
| /merchant/capacity · FN-CAL-01–02 | Weekly operating policy and day/product limits. Review impact before confirming changes. Show committed/pending states and linked orders, occupied/used totals and a disabled confirmation for blocked caps. Stale token returns to fresh preview. [Calendar flow](diagrams/SD-F02B.puml). |
| /merchant/work, /merchant/orders/:id · FN-ORD-05–08, FN-PAY-02–06, FN-ADM-03 | Filter by kind/status/date, review fee/serviceability, take permitted fulfilment actions, reconcile funds/refunds, request consent evidence for recovery and display stale/denied or unknown outcome state. Protected proof loads only on demand. |
| /merchant/events/:id · FN-EVT-02–09 | Inspect resource/time windows, send or supersede quote, verify deposit, choose late-verification disposition, reconcile balance or cancel within rules, inspect equipment and issue itemized extras. Keep actionable next steps separate from terminal states. |
| /merchant/work?kind=NOTICE, /merchant/reports · FN-NOT-03, FN-ADM-04–07 | Open scoped notice follow-up, record action or safe resend disposition, and show date/status report controls, partial/empty state and metric denominators. Expose launch check ownership in the release process. |

Display complete contact, fulfilment details, selected flavour and current terms in checkout review; edited inputs prompt a fresh review. Merchant can record driver arrival without recording handoff, send a revised fee/time before rejection and resolve delivery incidents before or after handoff. Payment UI distinguishes evidence rejection, order rejection, top-up, reconciliation and refund owed.

For a standard top-up, show outstanding amount and the server's MYT deadline, then switch to proof under review when appropriate. A timely proof under review keeps the hold even after the countdown ends. For an event balance under timely review, show that the slot remains reserved. The merchant view disables overdue cancellation while review is pending and requires an explicit bank check before submission when cancellation is available.

Before a standard order cancellation, ask whether the customer has sent a transfer. If sent or unsure, show the configured merchant WhatsApp contact instead of submitting a cancellation. Keep that route available for recorded proof or funds; the contact opens an external conversation. For an accepted event quote still awaiting deposit, let the customer cancel only after confirming no transfer. After transfer, hide self-cancellation and explain that a paid balance has no customer-initiated refund. Refresh on a cancellation conflict.

Event history shows requested, proposed and effective schedule separately. Distinguish awaiting deposit, proof review and confirmed schedule, and show outstanding obligations. Merchant can reopen saved equipment-out/check details and itemize a charge by item, reason and amount. Infeasible verification exposes consented reschedule/refund actions, not a confirmed balance deadline. Notice work shows attempt history and distinct audited manual-contact/provider-reconciled actions.

The event quote editor shows both positive instalments and a field error for totals below RM0.02. The event payment panel shows the verified outstanding amount, effective cutoff and current review or manual-reconciliation state. A supplement request keeps the displayed cutoff. Before accepting a reschedule with an outstanding balance, show the new event date, exact MYT due time and grace end. The merchant sees an actionable conflict and the prior schedule if the revised due time cannot be met.

The KPI view shows the server's counts and their date basis. For website-origin share, the merchant can supply the number of off-platform accepted orders/bookings for the same period as a report input; the view uses online count divided by online plus off-platform count. If the denominator is absent or zero, show the source counts and no percentage. This report input does not change orders or the ledger.

## 3. State, security and recovery

- Use memory-only server query state keyed by account and role. Clear it on logout or identity change. Filters may be in URL; drafts stay in memory. Never persist OTP, proof content, private drafts, cookies or contact details in browser storage. Prefer server-confirmed updates for money, capacity and quote status.
- On navigation/resume or a successful mutation, invalidate affected lists, cart and detail queries. Preserve last verified data with a stale indicator on recoverable read failure. Abort obsolete reads. For checkout, persist only opaque review and command IDs. After reload, show the submitted order if found; to start again, first abandon-or-resolve the old review. Persist no private request body. Other uncertain commands retain their key until reconciled.
- Render an actionable difference on stale version, deadline, amount or eligibility. Require deliberate confirmation for merchant financial and cancellation actions. Display localized dates in MYT and MYR amounts, and distinguish scheduled from actual handoff.
- Default mobile-first, keyboard-first form traversal and focus management, labelled inputs and announced status changes. Proposed acceptance matrix includes mobile Safari/Chrome and desktop Chrome/Edge/Safari; record tested versions during delivery. Design target: route-specific bundles, bounded queries, lazy images and no per-row requests in work queues.
- Sanitize content, apply a strict script policy, redact client events, keep source maps private, correlate errors by request ID. Use immutable public asset versions and validate frontend/backend contract compatibility before rollout or rollback.
- Merchant work exposes payment exceptions and refund intent disposition. Reschedule and delivery adjustments require a recorded customer consent reference. Customer sees separately consented charges and the effective event balance deadline after DEC-021. Catalogue filters use server-managed category labels.

## 4. Verification

Verify authenticated route isolation, two-device cart, revalidation and lost submission response, all standard fulfilment choices, quote and deposit deadline, proof retry and refund limits, equipment counts, failed notification queue, reporting, keyboard operation, small viewport and color contrast. Use current contract and synthetic provider/terms fixtures. Production browser evidence and rendering remain to be collected.
