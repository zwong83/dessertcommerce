# SweetCommerce System Analysis

Revision 1.2 BRD-reconciled analysis, 9 November 2026. [BRD 1.0-R2](../BRD/SweetCommerce/BRD-SweetCommerce.md), DEC-020–021 and the [owner-confirmed payment and cancellation rules DEC-022–029](../PRD/PRD-SweetCommerce.md#owner-confirmed-payment-and-cancellation-rules) govern behavior. The [PRD 1.2 functional reconciliation](../PRD/PRD-SweetCommerce.md#14-brd-functional-coverage) is the shared baseline inventory. The standard-order scope is approved. Increment 2 remains under review.

The application is greenfield in this workspace. The current manual process below is a schematic based on the merchant's confirmed pain points. Detailed FRS and a change request are not inputs for this new logical analysis. Detailed feature behavior is sourced from the signed BRD and elaborated PRD. Technical and launch-stage conditions remain in §9.

## 1. System context and main flow

| Diagram | Scope and source |
| --- | --- |
| [SA-00 Current context](diagrams/SA-00.puml) | Existing manual handoffs, BRD §1 |
| [SA-01 Current main flow and problems](diagrams/SA-01.puml) | BRD §1, P1 manual intake/date and capacity risk, P2 low visibility and repeated follow-up, P3 fragmented payment and reporting |
| [SA-02 Target context and integration boundaries](diagrams/SA-02.puml) | Trust boundaries and external dependencies, PRD §8 |
| [SA-03 Target main flow](diagrams/SA-03.puml) | Standard and event journeys, PRD F01–F08 |
| [SA-04 Customer use cases](diagrams/SA-04.puml) | PRD US-01–04 |
| [SA-05 Merchant use cases](diagrams/SA-05.puml) | PRD US-05–06 |

## 2. Roles and responsibilities

Customer reads and changes their own data. The dedicated administrator manages catalogue, orders, quotes, fulfilment, verification and adjustments. Human staff and external drivers are coordinated by the merchant. Notification and verification channels receive only necessary messages. Bank and delivery operations remain outside the application.

## 3. Feature reconciliation and diagram coverage

All v1 feature points are New in the application. As-Is refers to SA-01 where a corresponding manual issue is known. No existing system feature is retained. Guest access is Deleted from the superseded business draft, and PRD §10 items are Deferred. They have no v1 target view.

| Feature | Source | Change and owner | As-Is problem | Target | State/data/boundary |
| --- | --- | --- | --- | --- | --- |
| F01 Identity and persistent cart | PRD-01–03 | New · Customer account and cart | P2 · SA-01 | [SA-F01](diagrams/SA-F01.puml) | SA-D01, SA-02 |
| F02 Catalogue and production eligibility | PRD-04–06 | New · Catalogue and Capacity | P1 · SA-01 | [SA-F02](diagrams/SA-F02.puml) | SA-D01, SA-S01, SA-S03 |
| F03 Checkout and handoff | PRD-07–09 | New · Order and Fulfilment | P1,P2 · SA-01 | [SA-F03](diagrams/SA-F03.puml) | SA-D01, SA-S01, SA-S03 |
| F04 Standard settlement | PRD-10–12 | New · Settlement and Order | P1,P3 · SA-01 | [SA-F04](diagrams/SA-F04.puml) | SA-D01, SA-S01, SA-S03 |
| F05 Event enquiry and quote | PRD-13–14 | New · Event booking | P1,P2 · SA-01 | [SA-F05](diagrams/SA-F05.puml) | SA-D01, SA-S02, SA-S03 |
| F06 Event settlement and closure | PRD-15–17 | New · Event booking and Settlement | P2,P3 · SA-01 | [SA-F06](diagrams/SA-F06.puml) | SA-D01, SA-S02, SA-S03 |
| F07 Notifications and support | PRD-18 | New · Notification | P2 · SA-01 | [SA-F07](diagrams/SA-F07.puml) | SA-D01, SA-02 |
| F08 Admin and reporting | PRD-19–20 | New · Merchant Operations | P2,P3 · SA-01 | [SA-F08](diagrams/SA-F08.puml) | SA-D01 |
| Prior guest path | DEC-014 | Deleted · Identity | Superseded proposal | F01 | Account required |
| Deferred features | PRD §10 | Deferred · product owner | N/A | Excluded | N/A |

## 4. Per-feature logical analysis

### F01 Identity and persistent cart

[SA-F01 target logic](diagrams/SA-F01.puml) shows the feature decision path. Current problem links refer to the manual workflow, not to an existing deployed product.

| Concern | Analysis |
| --- | --- |
| Trigger and logical owner | Customer account and cart. Entry requires the role shown in the diagram; customer commands require an owned account. |
| Rules and recovery | A valid account owns a single cart. Failed verification changes no customer data. Order acceptance consumes the purchased quantities once. |
| Data/state effects | Identity owns account/session access; Cart owns selections and removal history. |
| Verification and SD handoff | UAT-007–008, UAT-014, UAT-016. Session/OTP boundary, account ownership and safe cart mutations. |

### F02 Catalogue and production eligibility

[SA-F02 target logic](diagrams/SA-F02.puml) shows the feature decision path. Current problem links refer to the manual workflow, not to an existing deployed product.

| Concern | Analysis |
| --- | --- |
| Trigger and logical owner | Catalogue and Capacity. Entry requires the role shown in the diagram; customer commands require an owned account. |
| Rules and recovery | Dates and quantities shown before checkout are advisory. At commitment check both the day-wide item limit and any product-specific limit. Used production is not restored after prep starts. |
| Data/state effects | Catalogue owns sellability and snapshots; Capacity owns holds and used quantities. |
| Verification and SD handoff | UAT-001–003, UAT-005–006, UAT-013. Local calendar semantics and atomic eligibility/last-unit adjudication. |

### F03 Checkout and handoff

[SA-F03 target logic](diagrams/SA-F03.puml) shows the feature decision path. Current problem links refer to the manual workflow, not to an existing deployed product.

| Concern | Analysis |
| --- | --- |
| Trigger and logical owner | Order and Fulfilment. Entry requires the role shown in the diagram; customer commands require an owned account. |
| Rules and recovery | One submission yields one order. Merchant-arranged delivery requires explicit fee acceptance before payment. Handoff uses one approved fulfilment mode. |
| Data/state effects | Order owns the final snapshot and accepted terms; Fulfilment owns operational status and actual handoff. |
| Verification and SD handoff | UAT-004, UAT-007–008, UAT-010–013. Order state guards, retry safety, fee consent and failure handling. |

### F04 Standard settlement

[SA-F04 target logic](diagrams/SA-F04.puml) shows the feature decision path. Current problem links refer to the manual workflow, not to an existing deployed product.

| Concern | Analysis |
| --- | --- |
| Trigger and logical owner | Settlement and Order. Entry requires the role shown in the diagram; customer commands require an owned account. |
| Rules and recovery | A proof is evidence awaiting verification. A timely proof keeps the hold. A merchant top-up notice starts a 30-minute proof window. Timely top-up proof preserves the hold through review. No timely proof releases unused capacity and routes funds to reconciliation. Cash reserves only when accepted and is collected at pickup. Refunds cannot exceed refundable receipts. |
| Data/state effects | Settlement owns proof/review and movements; Order and Capacity own acceptance and hold effects. |
| Verification and SD handoff | UAT-006, UAT-008–010, UAT-013. Expiry race, deduplicated ledger, reasoned refund and reconciliation. |

### F05 Event enquiry and quote

[SA-F05 target logic](diagrams/SA-F05.puml) shows the feature decision path. Current problem links refer to the manual workflow, not to an existing deployed product.

| Concern | Analysis |
| --- | --- |
| Trigger and logical owner | Event booking. Entry requires the role shown in the diagram; customer commands require an owned account. |
| Rules and recovery | Apply the seven-day and 22:00 rules to the event date. Merchant assesses shared resources manually. Quote carries consent terms, equipment, teardown time, payment deadlines and a recorded resource window. |
| Data/state effects | Event booking owns applications, quote versions and resource windows. |
| Verification and SD handoff | UAT-003, UAT-017–018. Version/expiry transitions, lead time, manual resource and kitchen availability views. |

### F06 Event settlement and closure

[SA-F06 target logic](diagrams/SA-F06.puml) shows the feature decision path. Current problem links refer to the manual workflow, not to an existing deployed product.

| Concern | Analysis |
| --- | --- |
| Trigger and logical owner | Event booking and Settlement. Entry requires the role shown in the diagram; customer commands require an owned account. |
| Rules and recovery | Deposit 50%; expiry is the earlier of three days after issue and event minus four days. DEC-020 preserves the resource window during review of timely deposit proof. Balance normally falls due at event minus three days with a 24-hour grace period. DEC-026 keeps the slot through review of timely balance proof. After the effective cutoff, only the merchant may cancel for nonpayment after completing review and verifying no balance funds arrived. Under DEC-021, verification after the original due date starts a fresh 24-hour balance window if feasible, or merchant-led reschedule/refund if infeasible. Additional invoice due event end plus two days. |
| Data/state effects | Event owns booking, equipment and charge evidence; Settlement owns transfer verification and receipts/refunds. |
| Verification and SD handoff | UAT-017–019. Independent instalment/invoice states and guarded financial effects. |

### F07 Notifications and support

[SA-F07 target logic](diagrams/SA-F07.puml) shows the feature decision path. Current problem links refer to the manual workflow, not to an existing deployed product.

| Concern | Analysis |
| --- | --- |
| Trigger and logical owner | Notification. Entry requires the role shown in the diagram; customer commands require an owned account. |
| Rules and recovery | Only recorded business transitions originate notices. WhatsApp is primary; SMS/email verification or approved fallback. Initial send plus up to three retries. Final failure requires operator visibility. |
| Data/state effects | Notification owns dispatch attempts; business domains own their statuses. |
| Verification and SD handoff | UAT-020. Reliable asynchronous dispatch, correlation, retries and operator follow-up. |

### F08 Admin and reporting

[SA-F08 target logic](diagrams/SA-F08.puml) shows the feature decision path. Current problem links refer to the manual workflow, not to an existing deployed product.

| Concern | Analysis |
| --- | --- |
| Trigger and logical owner | Merchant Operations. Entry requires the role shown in the diagram; customer commands require an owned account. |
| Rules and recovery | Only the dedicated administrator can execute protected actions. Reports use actual receipts/refunds in MYT and retain separate categories. Audit captures actor, action, reason and time. |
| Data/state effects | Operations owns work views and audit; reports derive from accepted domain facts. |
| Verification and SD handoff | UAT-014–015. Role and ownership enforcement, financial read model and privacy-safe audit. |

## 4.1 Detailed functional reconciliation

[PRD detailed function catalogue](../PRD/PRD-SweetCommerce.md#detailed-function-catalogue-and-acceptance) is the behavioral authority for these increments. This section maps each detail family to its logical flow, state responsibility, explicit failure boundaries and SD handoff. SA 1.2 is the candidate; SA 1.0 remains the previously accepted baseline.

| Detail IDs | Logical owner and target views | Required state, guard and exception | SD input |
| --- | --- | --- | --- |
| FN-ACC-01–02, FN-CART-01–03 | Identity and Cart · [SA-F01](diagrams/SA-F01.puml) | Owner check before reading or editing; only a verified session crosses the identity boundary. Cart remains separate from capacity. Checkout acceptance consumes matching purchased quantities exactly once. | Role-bound verification, session revocation and owned versioned cart commands |
| FN-CAT-01–04 | Catalogue · [SA-F02A](diagrams/SA-F02A.puml) | Draft, listed, suspended, sold out and archived have distinct merchant meanings. Candidate media is unexposed until attached to a saved product. Failed validation or stale save cannot replace the current gallery. | Product editor/media commands, durable gallery, authorized image delivery, publication controls |
| FN-CAL-01–04 | Capacity and Order · [SA-F02](diagrams/SA-F02.puml), [SA-F02B](diagrams/SA-F02B.puml) | Operating policy governs new options only. Closure and limit previews identify affected order states and occupied units. Existing promises survive closure; an invalid limit remains unapplied. Competing commitments and remakes count both day and product units. | Versioned calendar and impact queries, commit locks, current review token and exact MYT boundaries |
| FN-ORD-01–08 | Order and Fulfilment · [SA-F03](diagrams/SA-F03.puml), [SA-S01](diagrams/SA-S01.puml) | Review and submission are distinct; on uncertain response resolve the same intent. Fee offer is not commitment. Distinguish proposed/accepted and actual handoff, permissions, consented recovery, and terminal states. | Owned checkout/order views, merchant work projection and versioned fee/recovery contracts |
| FN-PAY-01–06 | Settlement, Capacity and Order · [SA-F04](diagrams/SA-F04.puml), [SA-S03](diagrams/SA-S03.puml) | Proof is review evidence, not confirmation. Timely proof stops expiry; late or mismatched funds never silently reopen. Cash capture competes with no-show. Refund reserve, uncertain, void and posted are separate. | Private proof access, one ledger effect, recoverable refund intent and expiry worker |
| FN-EVT-01–04 | Event Booking · [SA-F05](diagrams/SA-F05.puml), [SA-S02](diagrams/SA-S02.puml) | Seven-day eligibility and cutoff precede application. Merchant assessment precedes quote. Superseded quote cannot be accepted. An offered window is tentative, visible to merchant planning and released only under the approved rules. | Typed request and quote/version contracts, resource calendar and manual conflict review |
| FN-EVT-05–09 | Event, Equipment and Settlement · [SA-F06](diagrams/SA-F06.puml), [SA-S02](diagrams/SA-S02.puml) | DEC-020 preserves a timely deposit review; DEC-021 derives the effective balance or routes infeasible fulfilment for disposition. Show state per obligation. Merchant alone cancels after applicable grace. Inspection and extras retain separate evidence. | Versioned due work, effective balance, equipment counts, itemized additional charge and controlled reschedule/refund |
| FN-NOT-01–03 | Notification and operational follow-up · [SA-F07](diagrams/SA-F07.puml), [SA-S04](diagrams/SA-S04.puml) | Business state is authoritative. Keep eligible transition, attempt, outcome, retry and follow-up separate. No resend after unknown outcome without safe reconciliation. | Event/recipient matrix, delivery adapters, durable dispatch and failed-work read path |
| FN-ADM-01–03 | Identity and Merchant Operations · [SA-F08](diagrams/SA-F08.puml), [SA-F08A](diagrams/SA-F08A.puml) | A verified enrolled channel is required for ordinary recovery. Loss of all channels never provisions an account from user input; manual reset requires verified owner approval and revokes sessions. Privileged writes are auditable and replay-safe. | Account recovery/failure controls, bounded work and protected audit projections |
| FN-ADM-04–07 | Reporting and operational acceptance · [SA-F08](diagrams/SA-F08.puml) | Metrics derive from accepted business facts and posted movements in MYT. Read or reconcile without changing orders. Production setup, access/retention and recovery evidence are launch checks. | Report filters/date/category semantics and explicit launch configuration and restore handoff |

Logical data additions: product photo and ordered gallery relationship are catalogue-owned; calendar impact is a derived capacity/order view, never another order record; recovery evidence and prior-session invalidation are identity-owned. Media and proof have separate visibility policies. See [SA-D01](diagrams/SA-D01.puml).

### Reconciled logical paths

| BRD-driven operation | Normal, failure and recovery |
| --- | --- |
| FN-ACC-01; BR-CHK-001 | Challenge is bound to the verified phone identity. Only the matching challenge can establish the account/cart session; expiry and replay grant no access. |
| FN-ORD-01–02; BR-CHK-002–008 | Review captures contact, address/pickup, chosen flavour, items, time, fees, terms and payable amount. Changes lead to renewed review, not a silent submit. Once committed, the accepted snapshot remains readable. |
| FN-ORD-04–08; BRD §§2,7 | A serviceable counteroffer is visible before decline. Driver arrival is a separate fact from preparation readiness and actual handoff. An incident before or after handoff can reach agreed reschedule/redelivery or refund without changing historic facts. |
| FN-PAY-01–06; BR-CAP-004/006, BRD §10, DEC-022, DEC-025 | Keep evidence rejection, order rejection, supplement and verified receipt separate. Timely top-up proof preserves capacity past its 30-minute cutoff through review. Without timely proof, release unused capacity and reconcile any funds. Sent or uncertain funds block customer self-cancellation and route to the merchant via WhatsApp. Merchant inability to fulfil records a refund owed from verified receipts. |
| FN-EVT-01–07; BR-EVT-001–004, DEC-020–021, DEC-023–024, DEC-026–029 | Duplicate application returns the existing record. Only a quote of at least two sen enters the consent and payment path. Customer requests after transfer do not cancel the booking or refund a paid balance. A verified shortfall uses the current cutoff and separate receipts. Unresolved shortfall past cutoff goes to manual disposition. Timely proof retains review protection. Merchant nonpayment cancellation requires completed review and no balance funds. Agreed reschedule recalculates outstanding balance from the new event date with ordinary grace, or stays open for another date/refund. Merchant inability requires full refund. |
| FN-EVT-08–09; BR-EVT-005–007 | Merchant reads prior equipment-out/check facts and records changes. Valid counts precede itemized charges. Additional payment remains separate from the original balance. |
| FN-NOT-01–03, FN-ADM-04–05; BRD §§2,12–13 | Use milestone/source revision to derive notices and retry work. Show terminal/unknown attempts for manual resolution without business mutations. Reports use separate acceptance/booking, service, movement and quote cohort dates. |
| FN-ADM-07; BRD §16 | zwong owns request intake, authority verification, retention/disposition and outcome logging under approved launch policy. |

## 5. Logical data, ownership and state

| View | Question answered |
| --- | --- |
| [SA-D01 Conceptual model](diagrams/SA-D01.puml) | Who owns decisions, snapshots, allocation and finance evidence |
| [SA-S01 Standard lifecycle](diagrams/SA-S01.puml) | How order decisions proceed independently from payment evidence |
| [SA-S02 Event lifecycle](diagrams/SA-S02.puml) | When a quote tentatively reserves and when a booking becomes firm |
| [SA-S03 Allocation and settlement](diagrams/SA-S03.puml) | How financial state and production occupancy evolve independently |

| Ownership | Logical operations | State guard and evidence |
| --- | --- | --- |
| Identity / cart | Verify account; read/upsert/remove own selections; consume on accepted order | Existing verified account only. A repeat order acceptance cannot consume twice |
| Catalogue / capacity | Publish eligibility; create/release/commit holds; record consumed production | Both limits checked together; preparation makes allocation used |
| Standard order | Create snapshot; read by owner; transition and record handoff | Customer consent and merchant verification/acceptance; denied action leaves no change |
| Event booking | Create request and versioned quote; reserve window; inspect equipment and bill | Resource precheck precedes quote. Verified deposit confirms; expiry frees unused window |
| Settlement | Record proof, verify receipt, post/refund/derive totals | Provider transfer or cash is independently confirmed; duplicate evidence cannot double-post |
| Notification / reporting | Publish allowed milestones; record attempts; derive money and workload reports | Dispatch cannot mutate order state; reports use accepted business facts |

## 6. Integration and logical middleware

| Boundary | Business data and failure behavior | Design input |
| --- | --- | --- |
| OTP and notification providers | Verified contact and minimum message content. Expired OTP denies entry. Dispatch errors remain visible and retryable | Channel adapters, dispatch and correlation |
| DuitNow / Cash | Merchant reconciles funds against proof and charge reference. Wrong or late payments require review | Private evidence, settlement consistency, operator queue |
| Lalamove | Customer or merchant books externally. Merchant records serviceability, fee or handoff as applicable | Manual integration and minimal necessary address disclosure |
| Internal | Strongly consistent acceptance and receipts; durable asynchronous notice and expiry/review scheduling | Transactional store and reliable work mechanism. A separate cache, search index or broker has no proven v1 requirement |

## 7. Quality and security

| Protected asset or concern | Risk / expectation | Verification |
| --- | --- | --- |
| Customer identity and session | OTP abuse, replay and cross-account access. Challenge and owner boundary deny by default | Invalid/expired/reused OTP and foreign-resource tests |
| Admin control, payments and proof | Privilege escalation, false receipts and disclosure. Merchant verifies money and the system records authorized actions | Customer cannot call admin action. Proof hidden from other customers. Duplicate/refund races rejected |
| Holds, quote windows and dates | Oversell, expiry race and wrong local day. Availability advisory until commitment | Last-unit concurrency and exact local cutoff coverage |
| Notification, audit and recovery | External outage and personal data in evidence. Preserve the accepted state and minimally scoped history | Notice failure and restore drills with synthetic data |
| Customer web | Mobile access, label/focus, readable actionable errors | Keyboard, viewport and targeted browser scenarios |

## 8. Logical decisions

SA-DEC-01 separates customer account and admin permission boundaries (PRD-01, 19). SA-DEC-02 separates orders, allocations and settlement facts (PRD-06, 10–12). SA-DEC-03 keeps manual event capacity, manual transfers and manual Lalamove as operator decisions (PRD-07, 14–17). SA-DEC-04 isolates notification delivery from authoritative states (PRD-18). These follow the signed business baseline and carry into SD.

## 9. Risks, dependencies and review

| Item | Owner | Resolution point |
| --- | --- | --- |
| Provider and template details, browser matrix and benchmark load | Design review | SD. Use synthetic inputs during design and development |
| Real payment/refund verification, actual pickup/area, retention, recovery targets and provider readiness | zwong | Commercial launch acceptance |
| Product and analysis artifact review | zwong | SA 1.0 accepted as the SD baseline. Review the PRD elaboration against the signed BRD and record any business change upstream |

## 10. Verification and System Design handoff

The feature table covers PRD-01–20 and UAT-001–020 collectively. Use the linked flow and its verification row when designing and testing each feature. SD must define physical ownership, contracts, role checks, data/transaction constraints, error semantics, retry/expiry operations and deployment. Add the customer frontend only after backend contract boundaries are mapped.

The 46 PRD detail IDs map to logical owners, flow diagrams and SD inputs. The increment 1 scope of SA 1.2 is [owner-approved](../SD/SD-SweetCommerce-index.md#review-and-approval). Increment 2, diagram rendering and commercial launch evidence remain in review.
