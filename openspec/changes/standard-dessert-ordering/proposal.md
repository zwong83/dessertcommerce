## Why

SweetCommerce currently receives and tracks standard dessert orders through manual workflows. The first increment makes account, price, capacity, fulfilment and payment decisions visible in one place and gives the merchant a reliable record to reconcile.

## What Changes

- Introduce a signed-in customer storefront with OTP, an account-owned cart across devices, fixed products and a checkout review before any order commitment.
- Introduce the dedicated merchant portal for catalogue and photo management, capacity change review, orders, fulfilment, payment review and exception work.
- Support self pickup, merchant-arranged Lalamove and customer-arranged Lalamove, with manual fee confirmation when the merchant arranges delivery.
- Support merchant-verified DuitNow, Cash on pickup, expiry, reconciliation, refunds and guarded fulfilment. Implement the 30-minute top-up window and sent-transfer cancellation guard under DEC-025 and DEC-022.
- Deliver increment 1 only. [Dessert-table service](../dessert-table-service/proposal.md) tracks increment 2, including the wider business notification matrix and commercial reporting.

## Capabilities

### New Capabilities

- `customer-identity-cart`: verified account access, cross-device cart, safe versioned updates and one-time consumption of purchased items.
- `catalogue-production-capacity`: catalogue classification, sellability, preparation, booking eligibility and production allocation.
- `standard-checkout-fulfilment`: reviewed checkout, single-order submission, three handoff modes, order progress and consented recovery.
- `standard-settlement`: DuitNow and Cash, proof and expiry, underpayment/reconciliation, cancellation and guarded refunds.
- `merchant-standard-operations`: dedicated admin access, standard work queues, guarded actions and restricted audit records.

### Modified Capabilities

None. There are no published OpenSpec capabilities in this greenfield project.

## Impact

Two role-based Next.js web surfaces use the same versioned FastAPI API and PostgreSQL consistency boundary. The Python worker shares the backend domain and processes the existing durable job records. OTP and private proof storage are adapter boundaries; the first increment needs durable deadline work. Real transfers and Lalamove bookings remain external and merchant-operated. No existing application or migration baseline was found in the project root.

## Source Baseline

- [BRD 1.0-R2](../../../output/BRD/SweetCommerce/BRD-SweetCommerce.md) and [owner decisions DEC-022 and DEC-025](../../../output/PRD/PRD-SweetCommerce.md#owner-confirmed-payment-and-cancellation-rules) govern first-increment business policy. The previous PRD/SA 1.0 and SD 0.2 approvals remain historical. SRS/FRS are Not Applicable by owner decision. The recorded decisions and requested synchronization govern the planning delta for this unimplemented change.
- The synchronized change traces [PRD 1.2](../../../output/PRD/PRD-SweetCommerce.md), [SA 1.2](../../../output/SA/SA-SweetCommerce.md), [SD 0.5](../../../output/SD/SD-SweetCommerce-index.md) and the first-increment operations of [OpenAPI 0.4.0](../../../output/SD/contracts/sweetcommerce-v1.0.4.openapi.json). The owner approved this increment on 9 November 2026. The previous 0.2 contract remains historical.
- Scope covers PRD-01–12, applicable PRD-19, access/verification and the top-up notice. UAT-001–014 and UAT-016 cover standard ordering. UAT-003 excludes the event branch. UAT-020 applies here only to the top-up notice's delivery/replay isolation when exercised.

## Out of Scope

Dessert-table service and DEC-020–021/023–024/026, commercial reporting, guest access, automatic payment or delivery integrations, full milestone notification delivery/fallback, and commercial launch. Increment 1 includes a persisted customer-visible top-up notice and its delivery intent, plus a link to the merchant's external WhatsApp contact. FN-ADM-06–07 stay at the commercial launch gate for real setup, payment/provider evidence, privacy and restore acceptance. Apply requires [Test Analysis](test-analysis.md) and explicit implementation authorization.
