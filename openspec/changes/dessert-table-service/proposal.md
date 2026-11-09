## Why

SweetCommerce needs a traceable way for the merchant to assess shared resources, quote dessert-table service and reconcile staged payments and post-event charges. The second build increment completes that journey and adds the remaining business notices and commercial reporting for both v1 purchase paths.

## What Changes

- Add a signed-in dessert-table application and an event history separate from standard purchases. Let the merchant review feasibility, offer an alternative date or decline, issue versioned quotes and reserve assessed resource windows.
- Add manual DuitNow settlement for the event deposit, original balance and separate extras. Enforce positive instalments with a two-sen quote minimum. Protect timely proof review, use the existing cutoff for event shortfalls, and recalculate unpaid balance timing on an eligible reschedule.
- Record setup, actual event end, teardown and equipment movements. Show the customer confirmed arrangements, obligations and the result of each payment review.
- Deliver the remaining standard and event business notices and merchant alerts, with safe retry and audited manual follow-up. Add merchant work and audit projections for event and notice operations.
- Add MYT commercial reporting across standard and event commitments, preparation, receipts, refunds and first-month KPI baselines.

## Capabilities

### New Capabilities

- `dessert-table-application-quotation` — owned application and quote consent, manual resource assessment and tentative windows.
- `dessert-table-settlement` — deposit and original balance, transfer cutoff for cancellation, exception resolution and refunds.
- `dessert-table-service-closure` — actual service milestones, equipment checks and separate extra invoices and receipts.
- `commercial-business-notices` — remaining v1 standard/event and merchant milestones and operational follow-up.
- `commercial-operations-reporting` — event and notice work/audit extensions plus standard/event commercial reports.

### Modified Capabilities

## Source Baseline and Readiness

| Authority | Version and disposition |
| --- | --- |
| [Signed BRD](../../../output/BRD/SweetCommerce/BRD-SweetCommerce.md) §§2, 4–6, 9–21 | 1.0-R2 approved by zwong, including DEC-020–021 in §21. DEC-019 establishes the two-batch boundary. |
| [Owner decision log](../../../output/PRD/PRD-SweetCommerce.md#owner-confirmed-payment-and-cancellation-rules) | DEC-022–029 confirmed by zwong. DEC-020/021/023/024/026–029 govern this increment. DEC-022 and DEC-025 belong to standard ordering. The signed decisions and scope request are the Change Request context for this draft. |
| [PRD](../../../output/PRD/PRD-SweetCommerce.md) and [SA](../../../output/SA/SA-SweetCommerce.md) | 1.2 used as the implementation baseline under the owner’s request to implement the remaining work. PRD/SA 1.0 previously accepted. Separate SRS and FRS are owner-confirmed Not Applicable for v1. BRD, the PRD acceptance catalogue and SA flows are the equivalent sources. |
| [SD Index](../../../output/SD/SD-SweetCommerce-index.md), [Backend](../../../output/SD/SD-SweetCommerce-backend.md), [Frontend](../../../output/SD/SD-SweetCommerce-frontend.md), [Integration](../../../output/SD/SD-SweetCommerce-integration.md), [OpenAPI](../../../output/SD/contracts/sweetcommerce-v1.0.4.1.openapi.json), [database design](../../../output/SD/database/data-dictionary.md) | The increment 2 portions of SD 0.5 and OpenAPI 0.4.1 provide the implementation baseline. The approved increment 1 baseline stays on OpenAPI 0.4.0. |
| Application and OpenSpec baseline | Python/FastAPI, Next.js and PostgreSQL implementation. OpenSpec 1.2.0 uses the `spec-driven` schema. No published main specs. `standard-dessert-ordering` is a prerequisite and provides shared facilities under the agreed phase boundary. |

The owner requested implementation of all remaining work in both increments. The synchronized design and DEC-027–029 are the build baseline. [Test Analysis](test-analysis.md) maps each scenario to evidence, and [tasks](tasks.md) records implementation and remaining acceptance. Commercial launch is a separate gate.

## Impact

- Customer event routes and the merchant event, shared capacity, work and report surfaces use existing account and dedicated administrator boundaries. Event information extends the shared calendar, while standard capacity policy and edits stay with Increment 1.
- Reuse shared authentication, audit, proof storage, ledger/refund and durable-work facilities. Event rules, notice subscriptions and commercial read models own their effects. Standard notice triggers and report facts consume committed standard-domain outputs.
- The change introduces event application/quote/window, equipment and charge lifecycles, work revisions and commercial report projections. Align shared contract and job compatibility before rollout. No deployed app or data backfill is assumed.
- Merchant acceptance covers event timing, resource review, settlement and closure, role isolation, notification recovery and MYT reports. Real commercial configuration, bank/channel verification, privacy procedures and restore targets are separate launch gates.

## Out of Scope

- Increment 1 owns OTP, cart, catalogue, standard production and fulfilment, standard Cash/DuitNow and reconciliation, DEC-022/025 and the minimum top-up notice. This increment adds the remaining notice triggers and reporting over standard facts.
- Later features include automatic quoting or staff/routing, equipment deposits, gateways and Lalamove API, advanced analytics/export and multi-staff or multi-merchant operation.
