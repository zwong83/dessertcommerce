# SweetCommerce System Design Index

Revision 0.5 runtime migration design · 9 November 2026 · commercial v1 · business owner zwong. Increment 1 has scoped owner approval. Increment 2 uses the owner-directed build scope and tracks commercial acceptance separately.

## Sources and artifacts

| Artifact | Version and status |
| --- | --- |
| [BRD](../BRD/SweetCommerce/BRD-SweetCommerce.md) | 1.0-R2 approved, including subsequent confirmed DEC-020 and DEC-021 on event payments |
| [Owner payment and cancellation decisions](../PRD/PRD-SweetCommerce.md#owner-confirmed-payment-and-cancellation-rules) | DEC-022–029 confirmed on 9 November 2026. DEC-027–029 resolve increment 2 reschedule deadlines, underpayment and minimum quote. |
| [PRD](../PRD/PRD-SweetCommerce.md) | 1.2 approved for increment 1 and in review for increment 2 |
| [SA](../SA/SA-SweetCommerce.md) | 1.2 approved for increment 1 and in review for increment 2 |
| SRS and FRS | Not Applicable for v1 by explicit approval from zwong. The BRD, PRD acceptance catalogue and SA state/flow analysis supply the equivalent detail. |
| [Backend SD](SD-SweetCommerce-backend.md) | 0.5 runtime design, owner and transaction mapping |
| [Frontend SD](SD-SweetCommerce-frontend.md) | 0.5 runtime design, customer and merchant screen/action mapping |
| [Integration SD](SD-SweetCommerce-integration.md) | 0.5 runtime design, contract, permission and failure semantics |
| [API contract 0.4.0](contracts/sweetcommerce-v1.0.4.openapi.json) | 61 operations. The [49-operation increment 1 subset](../../openspec/changes/standard-dessert-ordering/design.md#contract-operations-and-task-ownership) is Contract-Ready as the design baseline. Provider and consumer execution is planned. [0.2.0](contracts/sweetcommerce-v1.openapi.json) and [0.3.0](contracts/sweetcommerce-v1.0.3.openapi.json) are historical. |
| [API contract 0.4.1](contracts/sweetcommerce-v1.0.4.1.openapi.json) | Increment 2 review candidate for DEC-027–029. Standard-order requests and responses retain their approved 0.4.0 shapes and semantics. |
| [Database design](database/data-dictionary.md) | Proposed PostgreSQL 16. Candidate gallery, operating policy and recovery metadata |
| [Deployment and middleware](diagrams/SD-A03.puml) | Proposed topology, design evidence pending |

## Feature coverage

All features are greenfield; prior manual workflow is [SA-01](../SA/diagrams/SA-01.puml). The target views include [architecture](diagrams/SD-A01.puml), [runtime](diagrams/SD-A02.puml), [deployment](diagrams/SD-A03.puml) and [physical data](diagrams/SD-D01.puml).

Technical lifecycles: [standard order](diagrams/SD-S01.puml), [event booking](diagrams/SD-S02.puml) and [durable work](diagrams/SD-S03.puml).

The [BRD-to-PRD/SA/SD crosswalk](../PRD/PRD-SweetCommerce.md#14-brd-functional-coverage) preserves the complete approved scope and explicit phase dispositions. The [PRD catalogue](../PRD/PRD-SweetCommerce.md#detailed-function-catalogue-and-acceptance) and [SA reconciliation](../SA/SA-SweetCommerce.md#41-detailed-functional-reconciliation) own acceptance and logical details. Supplementary design flows: [catalogue editor](diagrams/SD-F02A.puml), [capacity impact review](diagrams/SD-F02B.puml), [merchant recovery](diagrams/SD-F08A.puml) and [product visibility](diagrams/SD-S04.puml).

| Feature | Source / owner | Technical / UI | Data and verification |
| --- | --- | --- | --- |
| F01 OTP and cart version | PRD-01–03, SA-F01 · Identity / Cart | [SD-F01](diagrams/SD-F01.puml) · [UI](diagrams/SD-UI01.puml) | TX-01/02/04 · DML-01/02. UAT-007–008, 014, 016 |
| F02 Availability and last-unit allocation | PRD-04–06, SA-F02 · Catalogue / Capacity | [SD-F02](diagrams/SD-F02.puml) · [UI](diagrams/SD-UI02.puml) | TX-03/04 · DML-03/04. UAT-001–003, 005–006, 013 |
| F03 Fee consent, checkout and handoff | PRD-07–09, SA-F03 · Order / Fulfilment | [SD-F03](diagrams/SD-F03.puml) · [UI](diagrams/SD-UI03.puml) | TX-04 · DML-05. UAT-004, 007–008, 010–013 |
| F04 Standard proof, expiry and cash | PRD-10–12, SA-F04 · Settlement | [SD-F04](diagrams/SD-F04.puml) · [UI](diagrams/SD-UI04.puml) | TX-04/05/06 · DML-05/06/07. UAT-006, 008–010, 013 |
| F05 Manual event quote and version | PRD-13–14, SA-F05 · Event | [SD-F05](diagrams/SD-F05.puml) · [UI](diagrams/SD-UI05.puml) | TX-07 · DML-08. UAT-003, 017–018 |
| F06 Event settlement and equipment closure | PRD-15–17, SA-F06 · Event / Settlement | [SD-F06](diagrams/SD-F06.puml) · [UI](diagrams/SD-UI06.puml) | TX-05/06/07/08 · DML-06–10. UAT-017–019 |
| F07 Durable notification delivery | PRD-18, SA-F07 · Notification | [SD-F07](diagrams/SD-F07.puml) · [UI](diagrams/SD-UI07.puml) | TX-08 · DML-10. UAT-020 |
| F08 Merchant work, audit and reporting | PRD-19–20, SA-F08 · Merchant Operations | [SD-F08](diagrams/SD-F08.puml) · [UI](diagrams/SD-UI08.puml) | TX-01–08 · DML-01/11. UAT-014–015 |

## Specialist routing and readiness

| Profile | Scope and result |
| --- | --- |
| Architecture, Interface/Data | Required F01–F08. Routed and reconciled into Backend, contract and database artifacts |
| Frontend design | Required F01–F08. Draft 0.1.0 journey feedback incorporated into 0.2.0; post-revision contract checks pending |
| Quality attributes, Delivery/Operations | Required F01–F08. Routed and reconciled into trust, failure, recovery and topology controls |
| Independent review | The original 0.4 targeted re-review covered DEC-021 reschedule, cancellation, durable event replay and the owned order snapshot. DEC-022–026 were added after that review and their checks are in the [UAT contract checks](SD-SweetCommerce-integration.md#5-compatibility-and-contract-evidence). Formal approval and runtime evidence remain pending. |

| Gate | Evidence and state |
| --- | --- |
| Contract | Increment 1 baseline approved and reconciled with OpenSpec. Increment 2 scope still needs approval. Provider and consumer runtime evidence is pending for both. |
| Data | 34 proposed table definitions. SQL execution and concurrency evidence remain pending. |
| Middleware | Lease/recovery and catalogue-media separation documented. Worker and restore evidence remain pending. |
| Backend, Frontend, Integration | Eight feature groups, 46 detail points and 28 design diagram sources. Current rendering unverified. |
| Overall SD-Ready | 0.5 records the approved increment 1 behavior and runtime decision. Runtime parity evidence is tracked in OpenSpec. Increment 2 business decisions and the 0.4.1 implementation baseline are recorded. See OpenSpec for delivery evidence. |

The first increment uses Next.js/React/TypeScript for the storefront and portal, a Python/FastAPI API, an independent Python worker, PostgreSQL 16 and private evidence storage behind adapters. Revision 0.5 records the owner-directed runtime migration. SA 1.2 remains the behavior baseline and OpenAPI 0.4.0 remains the increment 1 contract. Production provider/host, privacy/retention, recovery targets, real payment verification and sender enrolment are launch gates.

## Review and approval

On 9 November 2026, zwong confirmed PRD 1.2, SA 1.2, SD 0.4 and the OpenAPI 0.4.0 design for increment 1 only, following the historical approval under SD 0.2 and the owner decisions DEC-022–026. The approved build scope is F01–F04, the applicable F08 controls, verification and the narrow top-up notice. The first-increment photo workflow and limits, OTP controls and synthetic verification targets use the reviewed SD values. Production policy and evidence remain launch items. Event service, remaining notices and commercial reporting are tracked separately for increment 2.

On the same date, zwong confirmed increment 2 business decisions DEC-027–029. The owner subsequently requested implementation of the remaining scope using the updated increment 2 design and 0.4.1 contract. Commercial acceptance remains a separate decision.

| Policy still needing owner decision | Scope and safe interim handling |
| --- | --- |
| Commercial configuration, retention/privacy handling, loss of all admin channels and recovery evidence | Launch only. zwong must confirm actual merchant/channel settings, approved procedures, and operational verification. |

BR-CAT-010 is interpreted within its product-catalogue section as per-product pause/sold-out; a shop-wide emergency switch is outside that source requirement.
