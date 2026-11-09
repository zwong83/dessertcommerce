# SweetCommerce Product Requirements Document

| Field | Value |
| --- | --- |
| Version / date | 1.2 BRD-reconciled review candidate · 9 November 2026 |
| Product owner | zwong |
| Release | Commercial v1, delivered in two build increments |
| Governing source | [SweetCommerce BRD 1.0-R2 and approved DEC-020–021](../BRD/SweetCommerce/BRD-SweetCommerce.md), plus the [owner-confirmed payment and cancellation rules](#owner-confirmed-payment-and-cancellation-rules) |
| Product status | zwong approved the increment 1 scope of PRD 1.2 and SA 1.2 on 9 November 2026. Increment 2 remains in review. Separate v1 SRS and FRS remain Not Applicable. [Scoped approval record](../SD/SD-SweetCommerce-index.md#review-and-approval). |

## 1. Overview

SweetCommerce is a single-merchant web store in Malaysia for standard desserts and separately quoted dessert-table services. Customers manage purchases and event requests in one account. The merchant manages fulfilment, capacity, payments and exceptions in a dedicated portal. Prices use MYR and operational dates use Asia/Kuala_Lumpur.

## 2. Problem statement

The merchant confirmed manual order and date checks, duplicate or missing records, fragmented payment tracking, limited capacity control, repeated customer queries and limited reporting. A shared order history and clear commitments reduce avoidable follow-up and missed fulfilment. The BRD supplies merchant observations. It supplies no quantitative pre-launch baseline.

## 3. Users

| Role | Primary need |
| --- | --- |
| Standard customer | Confirm availability and final cost, choose handoff, pay and track the order |
| Event customer | Request a package, confirm a dated quote, pay in stages and see logistics and charges |
| Merchant administrator | Manage the catalogue, capacity, quotes, payments, fulfilment, incidents and reporting |

## 4. Goals and metrics

| Goal | Measure | Window and owner |
| --- | --- | --- |
| BO-002 Reduce manual intake | Website-originated accepted orders or bookings divided by accepted orders or bookings across channels | Monthly, zwong supplies off-platform counts |
| BO-004 Protect fulfilment | Orders ready on or before promised handoff divided by standard orders due for preparation with a promised time | Monthly, zwong |
| BO-005 Improve conversion from event enquiry | Unique applications quoted in the period that eventually have a confirmed deposit divided by unique applications quoted in the period | Monthly cohort, zwong |

The first complete operating month establishes baselines. Numeric targets are set after measurement. Cross-account data exposure, duplicate orders or receipts, and over-committed production are acceptance failures regardless of KPI results.

## 5. Stories and journeys

| Story | User outcome | Goal | Feature |
| --- | --- | --- | --- |
| US-01 | As a customer I can log in on another device and resume my own cart | BO-007 | F01 |
| US-02 | As a customer I can order eligible desserts for the time and handoff I select | BO-001, BO-004 | F02, F03 |
| US-03 | As a customer I can see the final amount, payment instructions and fulfilment progress | BO-003, BO-007 | F03, F04 |
| US-04 | As an event customer I can request a package and understand the quote and all payment deadlines | BO-001, BO-007 | F05, F06 |
| US-05 | As a merchant I can manage availability, orders, bookings and exceptions with a history | BO-003, BO-005 | F02–F08 |
| US-06 | As a merchant I can reconcile cash, transfers, refunds and sales totals | BO-006 | F04, F06, F08 |

Standard journey: sign in → browse → cart → review fulfilment, time and price → submit → merchant acceptance or payment verification → prepare → hand off → complete. Merchant-arranged delivery adds a fee confirmation before payment.

Event journey: sign in → submit event request → receive and accept a quote → pay deposit → merchant verifies booking → pay balance → setup and teardown → check equipment and issue any extra bill.

## 6. Functional requirements

Priority P0 is required for the relevant increment. P1 is part of commercial v1 and may follow its core flow. The rows below translate confirmed BRD rules. Detail assigned to the design or launch stage is listed in §13.

### F01 Sign-in and persistent cart

| ID | Priority / increment | Requirement and acceptance | Source |
| --- | --- | --- | --- |
| PRD-01 | P0 / 1 | Require phone OTP login before catalogue, cart, ordering, event requests or tracking. Invalid or expired codes leave the customer at verification. A valid session permits continued access. An authenticated customer cannot access another account's resources or the admin portal. | BR-CHK-001, NFR-003–004, UAT-014 |
| PRD-02 | P0 / 1 | Restore the same cart on another device after login to the same account. Retain unpurchased items until removed. Changes appear when the cart is next loaded. Adding items does not reserve production. | BR-CART-001–007, UAT-016 |
| PRD-03 | P0 / 1 | At formal order acceptance, remove only the purchased quantities. Failed and expired orders leave the cart available. A repeated acceptance event cannot remove items twice. | BR-CART-008, UAT-007–008 |

### F02 Catalogue and standard production capacity

| ID | Priority / increment | Requirement and acceptance | Source |
| --- | --- | --- | --- |
| PRD-04 | P0 / 1 | The administrator manages products, fixed variants and flavours, price, images, preparation times, sale status and closure dates. Customers see eligible choices. Archived products remain identifiable in historical purchases. | BR-CAT-001–010, BR-CUS-001–002, UAT-001–002 |
| PRD-05 | P0 / 1 | Show handoff options constrained by lead time, configured business days and capacity. Same-day orders must meet the 18:00 submission cutoff, preparation requirements and 21:00 latest pickup or driver handoff. Online intake is available outside the merchant's 06:00–22:00 hours. | BRD §6.1, UAT-003, UAT-005 |
| PRD-06 | P0 / 1 | Measure daily standard capacity in items, with an optional per-product cap. All handoff modes share these limits. When two requests contend for the last unit only one may secure it. Release unused allocation on rejection, cancellation or expiry. Production already started consumes its allocation for that day. | BR-CAP-001–006, UAT-005–006, UAT-013 |

### F03 Standard checkout and fulfilment

| ID | Priority / increment | Requirement and acceptance | Source |
| --- | --- | --- | --- |
| PRD-07 | P0 / 1 | Offer pickup, merchant-arranged Lalamove or customer-arranged Lalamove. Show the fixed pickup point or collect one delivery address and contact. In merchant-arranged delivery, record serviceability, timing and the manually quoted fee. Recheck availability after the customer confirms the total. In customer-arranged delivery show that the order excludes the fee paid separately by the customer. | BR-DEL-001–010, BR-DEL-012–014, UAT-004, UAT-011–012 |
| PRD-08 | P0 / 1 | Before submission show the chosen items and final applicable amount. For an order awaiting a merchant fee, show that the amount awaits confirmation before payment. Preserve the accepted terms and final snapshot and issue one order number per submission. Paid orders cannot be self-edited. | BR-CHK-002–008, UAT-007–008 |
| PRD-09 | P0 / 1 | Track preparation, readiness, pickup or driver handoff, completion and failures. Record actual handoff and the reason for exceptions. Merchant handles redelivery, rescheduling and refund with the customer and obtains consent before any extra charge. | BR-DEL-008–014, BR-ORD-001–010, UAT-010–013 |

### F04 Standard payment, cancellation and exceptions

| ID | Priority / increment | Requirement and acceptance | Source |
| --- | --- | --- | --- |
| PRD-10 | P0 / 1 | Offer DuitNow for any standard handoff. After the final amount is agreed and capacity secured, show the QR and a 30-minute proof deadline. No timely proof expires the order and releases the hold. Timely proof holds capacity through review. Merchant verifies actual funds and amount before acceptance. When the merchant sends a top-up request, give 30 minutes to submit top-up proof and retain capacity through review if submitted in time. Reconcile partial, late or duplicate funds without silently rebooking. | BR-CAP-006–007, BR-PAY-001–008, DEC-025, UAT-008–009 |
| PRD-11 | P0 / 1 | Offer Cash only for pickup. No hold while awaiting acceptance. Merchant acceptance secures capacity and authorizes preparation. Merchant records payment at pickup or marks no-show if uncollected. Close or reschedule requests that can no longer be fulfilled in time. | BR-CAP-007, BR-PAY-009, UAT-010 |
| PRD-12 | P0 / 1 | Allow free customer cancellation before transfer and acceptance. Once a DuitNow transfer is sent, the customer cannot cancel in the app, even while proof or verification is pending. If funds were or may have been sent, direct the customer to the merchant on WhatsApp. After merchant acceptance of Cash, only merchant handling applies. If the merchant cannot fulfil, refund all receipts. Record exceptions and refunds up to the remaining refundable amount. | BR-ORD-010, BR-PAY-007, BRD §10.2, DEC-022, UAT-013 |

### F05 Event application, quotation and resource reservation

| ID | Priority / increment | Requirement and acceptance | Source |
| --- | --- | --- | --- |
| PRD-13 | P0 / 2 | Collect date, start/end and ready-by times, venue, guest count, budget, occasion, theme, special requirements and contact. Require at least seven days lead time, calculated from the next day after 22:00. Validate time consistency and let a customer state that no special requirements apply. | BR-EVT-001, BRD §6.1, UAT-003, UAT-017 |
| PRD-14 | P0 / 2 | Merchant manually checks staff, kitchen, venue and travel, setup, teardown and equipment, then records the resource window and quote version. Quote states items, price, equipment list, same-day teardown time, known additional-charge rules, payment deadlines and the cancellation cutoff at transfer. An accepted quote can still be cancelled by the customer before any transfer. Release unused windows on valid cancellation or eligible expiry and confirm the booking upon verified deposit. | BR-EVT-002–005, BR-CAP-008, DEC-023, UAT-017–018 |

### F06 Event payments and completion

| ID | Priority / increment | Requirement and acceptance | Source |
| --- | --- | --- | --- |
| PRD-15 | P0 / 2 | Require DuitNow only, with a 50% deposit. Quote total must be at least RM0.02 so both instalments are positive. Quote expiry is the earlier of three days after issue and the deposit deadline no later than four days before the event. Timely proof preserves the window through review. On a verified shortfall, request the difference before the original cutoff or route to manual resolution after cutoff. Only the exact verified deposit on an eligible quote confirms the booking. | BR-PAY-007, BR-PAY-010, DEC-020, DEC-028–029, UAT-017–018 |
| PRD-16 | P0 / 2 | Original balance is due three days before the event with 24 hours' grace. Timely proof keeps the booking reserved through merchant review. After cutoff, merchant nonpayment cancellation requires resolved review and no balance funds received. A verified shortfall retains the effective cutoff and goes to manual resolution if still open after cutoff. If timely deposit proof is verified after the original balance deadline and fulfilment remains feasible, allow 24 hours from confirmation to pay. If infeasible, arrange reschedule or refund. On agreed reschedule, recalculate outstanding balance from the new event date with ordinary grace, subject to a future due time. A paid balance does not permit customer cancellation or a customer-initiated refund. | BR-PAY-007/011, DEC-021, DEC-024, DEC-026–028, BRD §10.2, UAT-018 |
| PRD-17 | P0 / 2 | Log equipment quantities out and checked back. Itemize lost or damaged equipment and extra waiting or staffing against the disclosed terms. Invoice those separately from the original balance, due within two days of event end, and show payment confirmation. | BR-EVT-005–007, BR-PAY-012, UAT-019 |

### F07 Notifications and F08 Operations

| ID | Priority / increment | Requirement and acceptance | Source |
| --- | --- | --- | --- |
| PRD-18 | P1 / shared | Notify customers and merchant for the milestones in BRD §12. Use WhatsApp for business notices and SMS or email for verification or fallback. Retry delivery up to three times, record outcomes, alert the merchant and support manual contact. Failed notifications never change order or payment status. | BR-NOT-001–006, UAT-020 |
| PRD-19 | P0 / shared | Provide one dedicated admin account with verified phone or email recovery. View and filter pending work and preserve actor, time, change and reason for key actions. Recovery and failed access must protect admin privileges. | BR-ADM-001–010, UAT-014 |
| PRD-20 | P1 / shared | Report accepted orders, prep demand, receipts and refunds in MYT by actual cash movement dates. Separate standard receipts, event deposits, balances and extras. Net receipts equal recorded receipts less recorded refunds. Support KPI calculations and the merchant's off-platform counts. | BR-RPT-001–005, BR-RPT-007, UAT-015 |

### Detailed function catalogue and acceptance

Revision 1.2 review candidate. This catalogue elaborates the signed BRD. Each row defines the actor, surface, rule and observable acceptance. Delivery 1 means the standard-order build, 2 means dessert-table build, Shared means commercial v1 capabilities staged across the builds, and Launch means operational acceptance. [BRD coverage reconciliation](#14-brd-functional-coverage) maps each obligation to its downstream evidence and disposition. PRD-01–20 remain the stable parent requirements.

#### F01 Account and cart

| Detail ID | Delivery | Role and entry | Required behavior and observable outcome | Source |
| --- | --- | --- | --- | --- |
| FN-ACC-01 | 1 | Customer · sign-in | Request and verify a phone OTP. Invalid, expired, reused or unavailable verification creates no session; a valid challenge opens the customer workspace. | BR-CHK-001; PRD-01; UAT-014 |
| FN-ACC-02 | 1 | Customer · sign-in/session | Require sign-in for browsing, ordering, event requests and account history. A customer can read only owned records; logout clears access and private cached views. | BR-CHK-001; NFR-003–004; PRD-01; UAT-014 |
| FN-CART-01 | 1 | Customer · product and cart | Add an eligible variant, change quantity, remove lines and see a reference total. Invalid quantity or unavailable variants receive actionable feedback. Cart changes hold no production. | BR-CART-001–006; PRD-02; UAT-002, UAT-016 |
| FN-CART-02 | 1 | Customer · cart on another device | Load the same persistent cart after sign-in. Unpurchased lines have no inactivity expiry. Stale edits reload the current cart and preserve newer changes. | BR-CART-007; PRD-02; UAT-016 |
| FN-CART-03 | 1 | Customer · order acceptance | Remove accepted quantities once from matching lines. Preserve other items, replacement lines, and quantities from failed or expired orders. | BR-CART-008; PRD-03; UAT-007–008 |

#### F02 Catalogue, calendar and production

| Detail ID | Delivery | Role and entry | Required behavior and observable outcome | Source |
| --- | --- | --- | --- | --- |
| FN-CAT-01 | 1 | Merchant · product list and editor | Create a draft; edit name, category, fixed variants/flavours, price and preparation time; review field errors without losing the draft. | BR-CAT-001–004, BR-CAT-007–008; PRD-04; UAT-002 |
| FN-CAT-02 | 1 / clarification | Merchant · product photo editor | Choose photos on mobile or desktop; preview, reorder, replace and remove. Failed upload or save leaves the previous saved gallery intact. A successful save is reflected in the storefront. | BR-CAT-005–006; PRD-04; proposed interaction for existing photo requirement |
| FN-CAT-03 | 1 | Merchant · publication controls | Publish, unpublish, suspend, mark sold out, restore sellability or archive as permitted. A draft/hidden item cannot enter new checkout; archival preserves historic descriptions and prices. | BR-CAT-001–004, BR-CAT-007, BR-CAT-010; PRD-04; UAT-001–002 |
| FN-CAT-04 | 1 | Customer · shop and item | Browse available categories, products, photos, prices and fixed variants/flavours. Show loading, empty and retry states. A removed or unavailable choice is rejected at recheck. | BR-CAT-005–006, BR-CUS-001–002; PRD-04; UAT-001–002 |
| FN-CAL-01 | 1 | Merchant · capacity calendar | Review operating policy, future capacity and closure dates; set a day and product quantity limit. The store accepts online requests at all hours; evaluate handoff within configured business dates and hours. | BR-PRE-001–007, BR-CAP-001, BR-CAP-005; PRD-05–06; UAT-003, UAT-005 |
| FN-CAL-02 | 1 | Merchant · capacity change review | Before saving a closure or cap change, show affected dates, occupied units, and affected orders with status and links. Save closure without cancelling orders. Reject a limit below committed or used totals and let the merchant resolve the affected work. | BRD §6.1, BR-CAP-005; PRD-06; UAT-005, UAT-013 |
| FN-CAL-03 | 1 | Customer · handoff date/time picker | In MYT, apply 18:00 same-day submission, 21:00 latest pickup/driver handoff, preparation time, operating calendar, closures and capacity. Show eligible alternatives when the requested time fails. | BR-PRE-001–007; PRD-05; UAT-003, UAT-005 |
| FN-CAL-04 | 1 | System · standard order commitment | Check daily and product caps atomically across all three handoff modes. One contender can secure the last unit. Release unused holds once and retain used production, including during remakes. | BR-CAP-001–007; PRD-06; UAT-005–006, UAT-013 |

#### F03 Checkout, delivery and tracking

| Detail ID | Delivery | Role and entry | Required behavior and observable outcome | Source |
| --- | --- | --- | --- | --- |
| FN-ORD-01 | 1 | Customer · checkout review | Before submission, review the captured contact, time, fulfilment details (pickup point or delivery address), selected items, fees, terms and total. If a fee awaits the merchant, show the provisional amount. Changed reviewed details or expired review require renewed confirmation. | BR-CART-005–006, BR-CHK-002–005; PRD-08; UAT-007 |
| FN-ORD-02 | 1 | Customer · checkout submission | Create one order number and immutable purchase/consent snapshot per reviewed intent. After an uncertain response, resolve or abandon the same review before starting again. A paid order cannot be edited by the customer. | BR-CHK-002–008, BR-ORD-001–009; PRD-08; UAT-007–008 |
| FN-ORD-03 | 1 | Customer · pickup choice | Show the fixed pickup point and promised time with no delivery fee. Offer Cash or DuitNow when eligible. | BR-DEL-012; PRD-07; UAT-010 |
| FN-ORD-04 | 1 | Customer · delivery choice | Collect one address, contact, required phone, optional notification email and permitted notes. For customer-arranged Lalamove, explain separately paid transport and agreed risk terms. The order uses DuitNow for merchant charges. | BR-DEL-001–004, BR-DEL-008–010, BR-DEL-013, BRD §§7,12; PRD-07; UAT-011 |
| FN-ORD-05 | 1 | Merchant and customer · delivery fee offer | Merchant checks area, time and fee manually or records unserviceable. Customer reviews exact fee and terms. Only current consent with available capacity begins payment; stale offers and declines cannot collect. | BR-DEL-005–007, BR-CAP-007; PRD-07; UAT-004, UAT-012 |
| FN-ORD-06 | 1 | Merchant · order queue and fulfilment | Filter and open the order; record permitted confirmation, preparation, ready, pickup/driver handoff, completion and reasons for exceptions. Record promised, ready, driver arrival and actual handoff times separately. A late driver does not make a timely prepared order late. | BRD §2, BR-ORD-001–009, BR-DEL-008–010; PRD-09, PRD-19; UAT-010–012 |
| FN-ORD-07 | 1 | Customer · my standard orders | List and open owned standard orders. Distinguish fee needed, proof review, verified, preparing, ready, handoff, completion, expiry, rejection, cancellation, no-show and incident as applicable. Show next action without exposing internal review notes. | BR-ORD-001–009; PRD-09; UAT-007, UAT-010–014 |
| FN-ORD-08 | 1 | Merchant · incident recovery | Record failed delivery and coordinate reschedule, redelivery or refund. Require customer consent for new promises or extra charges; preserve prior commitments on failure and original purchase totals. | BR-DEL-014, BR-ORD-010; PRD-09, PRD-12; UAT-012–013 |

#### F04 Standard settlement and cancellation

| Detail ID | Delivery | Role and entry | Required behavior and observable outcome | Source |
| --- | --- | --- | --- | --- |
| FN-PAY-01 | 1 | Customer · DuitNow checkout | Show the merchant QR and exact payable amount only after agreed terms and capacity hold. Show 30-minute proof deadline and upload success/error. Timely registered proof preserves the hold during review. | BR-PAY-001–006, BR-CAP-006–007; PRD-10; UAT-009 |
| FN-PAY-02 | 1 | System · proof and expiry | Expire unproven orders and release unused holds once. Owned late evidence enters merchant reconciliation without reopening capacity. Reject foreign, invalid or oversized files without mutation. | BR-PAY-001–008, BR-CAP-004, BR-CAP-006; PRD-10; UAT-008–009, UAT-014 |
| FN-PAY-03 | 1 | Merchant and customer · payment work | Review private proof and verify actual funds independently. For an active underpayment, show the amount still owed and a 30-minute proof deadline from the merchant's top-up notice. A timely top-up proof keeps the hold through review. With no timely proof, release unused capacity at expiry and reconcile the initial and any late transfers. Exact verified total may accept an eligible order once; if fulfilment became infeasible, arrange reschedule or refund. | BR-PAY-001–008, BR-CAP-006, DEC-025; PRD-10; UAT-008–009 |
| FN-PAY-04 | 1 | Merchant · Cash pickup | Accept Cash pickup only after current feasibility; reserve at acceptance. At handoff record Cash and actual pickup together. Mark an uncollected order no-show without posting a receipt. | BR-PAY-009, BR-CAP-007; PRD-11; UAT-010 |
| FN-PAY-05 | 1 | Customer and merchant · cancellation | Customer confirms no transfer was made and may cancel an otherwise eligible unpaid, unaccepted order. If transfer was sent, may have been sent, or payment evidence is recorded, block self-cancellation and show the merchant's WhatsApp contact for manual follow-up. Merchant records any authorized exception and reason. Release unused capacity only on an authorized terminal disposition. Merchant inability to fulfil records the full remaining refund due on verified receipts. | BR-ORD-010, BR-PAY-007, BRD §10.2, DEC-022; PRD-12; UAT-013 |
| FN-PAY-06 | 1 | Merchant · refund disposition | Reserve refundable funds before external payout. Post verified payout once, keep uncertain payouts reserved, and release only after verified non-payout. A refund cannot exceed remaining verified receipts. | BR-PAY-007, BRD §10.2; PRD-12; UAT-008, UAT-013 |

#### F05 Event application, resource assessment and quote

| Detail ID | Delivery | Role and entry | Required behavior and observable outcome | Source |
| --- | --- | --- | --- | --- |
| FN-EVT-01 | 2 | Customer · dessert-table request | Enter date, start/end, ready-by time, venue, guest count, budget, occasion, theme, requirements and contact with required phone and optional notification email. Validate seven-day lead time and next-day calculation after 22:00. Keep form inputs on correctable error. Repeated submission of the same intent returns the same application. | BO-003, BR-EVT-001, BRD §§6.1,12; PRD-13; UAT-003, UAT-008, UAT-017 |
| FN-EVT-02 | 2 | Merchant · event assessment | Review kitchen, staffing, travel between locations, setup, teardown, equipment and overlapping windows. Record resources and timing manually. Consult shared capacity and adjust standard availability if needed. | BR-EVT-002, BR-CAP-008; PRD-14; UAT-017 |
| FN-EVT-03 | 2 | Merchant · quote editor | Issue a versioned quote with package, services, total, positive deposit and balance, payment deadlines, exact event/setup/same-day teardown times, equipment and disclosed extra charges. Reject totals below RM0.02 without creating or replacing a quote or window. An alternative date becomes a commitment through a current accepted quote and verified deposit. | BR-EVT-003–004, BR-PAY-010, DEC-029; PRD-14–15; UAT-017–018 |
| FN-EVT-04 | 2 | Customer · quote and event timeline | Review and accept only the current offer and terms. Allow free cancellation of an owned application or quote before any transfer, including after quote acceptance while awaiting deposit. After the customer sends a transfer, block cancellation even if proof is pending or verification has not finished. Show accepted awaiting-deposit separately from proof review. Valid cancellation or eligible expiry releases unused resources. Keep event history separate from standard purchases. | BR-EVT-004, BR-EVT-007, BRD §10.2, DEC-023; PRD-14–15; UAT-017–018 |

#### F06 Event settlement, service and closure

| Detail ID | Delivery | Role and entry | Required behavior and observable outcome | Source |
| --- | --- | --- | --- | --- |
| FN-EVT-05 | 2 | Customer and merchant · deposit | Use DuitNow only. Deposit is 50%, rounded up to a whole sen for odd totals, and due by the earlier of quote issue plus three days and the offered deadline no later than event minus four days. Timely proof preserves the slot through review. Verify split receipts separately and confirm once at exact total if eligible. Before cutoff, a verified shortfall uses the existing deadline. After cutoff, an unresolved shortfall needs manual disposition. | BR-PAY-007, BR-PAY-010, DEC-020, DEC-028–029; PRD-15; UAT-017–018 |
| FN-EVT-06 | 2 | Customer and merchant · balance and grace | Original balance due three days before the event with 24 hours' ordinary grace. Under DEC-021, late verification of timely deposit proof gives one 24-hour window from confirmation if feasible. Timely balance proof preserves resources through review. A verified shortfall can be supplemented within the existing effective cutoff. An unresolved shortfall after cutoff goes to manual resolution. Show the review state and suppress stale reminders. | BR-PAY-007, BR-PAY-011, DEC-021, DEC-026, DEC-028; PRD-16; UAT-018 |
| FN-EVT-07 | 2 | Merchant · event cancellation or reschedule | Customer cancellation ends at first transfer and paid balance is not customer-refundable. Merchant inability requires full refund of receipts. Overdue cancellation requires no balance funds and resolved timely review after cutoff. For a mutually agreed reschedule, retain settled balance and past receipts. For unpaid balance, calculate due on the new MYT event date minus three days, with 24 hours' grace. If the new due time has passed or cannot be met, retain the case and agree another date or refund. Record the reason and consent, including for a force-majeure disposition. Release only unused resources. | BR-EVT-004, BRD §10.2, DEC-021, DEC-023–024, DEC-026–027; PRD-16; UAT-018 |
| FN-EVT-08 | 2 | Merchant · setup, teardown and equipment | Record setup and actual end/teardown; track equipment out and returned, including damaged and lost counts. Validate quantities. Preserve check history and show the customer the confirmed arrangements. | BR-EVT-005, BR-EVT-007; PRD-17; UAT-019 |
| FN-EVT-09 | 2 | Merchant and customer · extras | Itemize waiting/staffing, damage or loss with reason and amount, separately from original balance. Show due date of two days after actual event end, independently verify DuitNow and show the paid or open status. | BR-EVT-006–007, BR-PAY-012; PRD-17; UAT-019 |

#### F07 Business notices and manual fallback

| Detail ID | Delivery | Role and entry | Required behavior and observable outcome | Source |
| --- | --- | --- | --- | --- |
| FN-NOT-01 | Shared | Customer · standard-order notices | Notify submitted, waiting payment, accepted/rejected payment or Cash, preparation, pickup-ready, driver handoff, completion, cancellation, refund and expiry milestones. | BRD §12; PRD-18; UAT-020 |
| FN-NOT-02 | Shared | Customer · event notices | Notify request received, quote and expiry reminder, deposit confirmed, booking confirmed, balance due, event/teardown arrangements, completion, equipment damage/loss, waiting or other itemized extras, and extra payment receipt. | BRD §12; PRD-18; UAT-020 |
| FN-NOT-03 | Shared | Merchant · intake and follow-up | Notify new applications/orders, work needing action and repeated failure. Use WhatsApp as primary and SMS or email for verification or approved fallback. Show attempt history and final/unknown outcome, retry up to three times when safe and allow audited manual follow-up without changing order or payment state. | BR-NOT-001–006, INT-002; PRD-18; UAT-020 |

#### F08 Merchant access, audit, reports and configuration

| Detail ID | Delivery | Role and entry | Required behavior and observable outcome | Source |
| --- | --- | --- | --- | --- |
| FN-ADM-01 | 1 | Merchant · dedicated sign-in | Only the enrolled dedicated administrator can sign in and execute merchant actions. Customer role and unknown identities cannot provision an admin or enter the portal. | BR-ADM-001–010, NFR-003; PRD-19; UAT-014 |
| FN-ADM-02 | 1 / clarification | Merchant · recover access | If either enrolled verified phone or email still works, verify it and regain access. If neither is available, use a restricted manual owner-verification path. Never issue access based only on a newly supplied contact. Record outcome and revoke old sessions after a contact reset. | BRD §11, §20.3; PRD-19; recovery operating procedure proposed for launch |
| FN-ADM-03 | 1 and 2 | Merchant · work and audit | List/filter role-scoped pending work and link to the correct owned domain record. Record actor, time, change and safe reason for login, price/rules, order state, payment, refund and extra charges. Avoid duplicate business audit on replay. | BR-ADM-001–010, BR-ORD-001–009, NFR-007–008; PRD-19; UAT-014 |
| FN-ADM-04 | Shared | Merchant · basic reporting | Filter dates/status and show accepted orders, daily prep demand, receipts, refunds and net. Use MYT and actual money dates; separate standard, event deposit, balance and extras. Keep advanced reporting/export out of v1. | BR-RPT-001–005, BR-RPT-007; PRD-20; UAT-015 |
| FN-ADM-05 | Shared | Merchant · KPI review | Use first complete month for baseline; support website-origin share with merchant-provided off-platform count, on-time standard preparation and quote cohort conversion after deposit. | BO-002, BO-004, BO-005, BRD §2; PRD §4, PRD-20 |
| FN-ADM-06 | Launch | Merchant · commercial setup | Confirm actual products/prices, pickup location, service area, calendar, terms, provider enrolment and staffing. Verify real DuitNow/refunds, Cash, WhatsApp and verification fallback before commercial launch. | BRD §18, §20.3; PRD §13 |
| FN-ADM-07 | Launch | Merchant · privacy and recovery acceptance | zwong receives customer deletion/anonymization requests, verifies requester authority under the approved procedure, applies the relevant classification/retention rule and records the outcome. Verify owner access, retained historical records, backup and restore. Final retention, identity-check procedure and recovery targets require launch approval. | NFR-003–004, NFR-007–009, NFR-012; BRD §16, §20.3; PRD §7 |

## 7. Non-functional requirements

- Require authenticated ownership and admin separation for every sensitive action. Payment proof and contact details are restricted to authorized parties and handled under the merchant's launch policy.
- Protect orders, reservations and receipts from duplicates and preserve historical terms. Staff can locate and resolve payment and notification incidents.
- Provide mobile-friendly screens, keyboard navigation, visible focus, labels and recoverable errors. Confirm browser coverage and performance test workload during design.
- Validate restore capability before launch. Production data retention, recovery time and permissible data loss are launch acceptance items owned by zwong.

## 8. Product-level technical considerations

Web customer storefront and merchant portal share a business baseline. DuitNow and Cash are manually reconciled. Lalamove is arranged outside the product. OTP and notification service details are selected in design and verified before launch. Sensitive receipts, addresses and verification data require restricted access. Keep physical storage, API and technology decisions in SD.

## 9. UI/UX requirements

| Surface | Interaction and states |
| --- | --- |
| Sign-in and storefront | Phone, OTP and expiry/resend feedback. Catalogue with prices, availability, empty and recoverable loading/error states. |
| Cart and checkout | Items, quantity edits, invalid item feedback, fulfilment selection and price review. Revalidate when resuming. Explain price/time changes, fees, waiting for merchant quote and payment deadlines. |
| My activity | Separate standard orders and events. Show last verified status, next action and deadlines. Distinguish proof received, verified and exception. |
| Event request and quote | Label required event details and field errors. Present booking window, quote, setup and teardown, equipment terms and instalments before consent. |
| Merchant portal | Work queues for pending requests and payments, capacity, status changes, exceptions and reports. Confirm irreversible operational actions and show outcome. |

Customer surfaces use the [Gather Dessert reference](../BRD/SweetCommerce/gather-dessert-logo-reference.jpg) and approximate coral, cream, burgundy and gold palette in the BRD. Validate contrast for actual text/background combinations. Present MYR and local times throughout.

## 10. Out of scope

Guest checkout, public catalogue, free-form standard customizations, AI quotes, automatic staff or route scheduling, equipment deposits, Lalamove API, payment gateway, memberships, multi-staff authorization, advanced reporting and export, multiple merchants, native apps, and warehouse/POS accounting.

## 11. Milestones

1. Standard checkout: F01–F04 and merchant operations needed to fulfil and reconcile.
2. Dessert-table service: F05–F06 and shared notifications and reporting across both.
3. Commercial release: both increments pass the BRD acceptance scenarios, operational configurations are verified and zwong approves launch. No calendar commitment is established.

## 12. Risks and mitigations

| Risk | Treatment | Owner |
| --- | --- | --- |
| Overbooking or stale pickup promises | Revalidate at commitment, isolate capacity decisions, record event windows and manually coordinate kitchen usage | zwong |
| Proof mismatch or delayed review | Clear pending state, deduplication, verification and manual exception queue | zwong |
| Uncollected cash, delivery failure, fee dispute | Cash only at pickup, explicit fees and handoff history, manual incident handling | zwong |
| Account abuse or notification failure | Isolation, verification, limited access, audit, retry and operator follow-up | zwong |

## 13. Open items, acceptance and approval

R2 and DEC-020–021 govern the signed baseline. The owner confirmed DEC-022–029 on 9 November 2026. The [SD Index review register](../SD/SD-SweetCommerce-index.md#review-and-approval) records increment 1 approval, including the FN-CAT-02 photo workflow. Increment 2 source and contract review remain separate from these confirmed business decisions. The exact FN-ADM-02 all-channel-loss procedure, real configuration, payment/refund verification, retention and recovery are commercial launch conditions.

Product behavior is traceable via each requirement's BRD/UAT mapping. Product review and commercial acceptance are owned by zwong. Record requested changes against the affected PRD IDs and obtain a new business decision if they change the approved baseline.

### Owner-confirmed payment and cancellation rules

| Decision | Owner-confirmed behavior |
| --- | --- |
| DEC-022 · Standard DuitNow | After sending a transfer, customers cannot cancel. They contact the merchant on WhatsApp for follow-up. The proof upload or review time does not determine eligibility. |
| DEC-023 · Event deposit | Customers can cancel before sending any transfer, including after accepting a quote. From the first transfer onward, customer cancellation is blocked. This supersedes the earlier event customer-cancellation timing in BRD §10.2. |
| DEC-024 · Event balance | After balance payment, customer-requested cancellation is unavailable and no customer-initiated refund is due, regardless of how far away the event is. The merchant-inability full-refund rule still applies. |
| DEC-025 · Standard top-up | Hold production capacity for 30 minutes from the merchant's top-up notice. If top-up proof is submitted before the deadline, keep the hold through merchant verification. Without timely proof, release unused capacity when the window ends and reconcile any funds separately. |
| DEC-026 · Event balance review | A balance proof submitted before the effective cutoff keeps the event slot reserved through merchant review. Only after the effective cutoff and confirmation that no balance funds were received may the merchant cancel for nonpayment. |
| DEC-027 · Event reschedule | For an agreed new event date with balance outstanding, set the due date to three days before the new event in MYT, with 24 hours' grace. If that due time cannot still be met, agree another date or refund. Keep any settled balance and verified receipts. |
| DEC-028 · Event underpayment | For a verified deposit or original balance shortfall, tell the customer the difference and retain the existing payment cutoff. Verify each transfer separately. Only the exact verified total on an eligible charge confirms settlement. If a shortfall remains after cutoff, handle it manually without a new timer. Timely proof retains review protection. |
| DEC-029 · Event quote minimum | Require at least RM0.02 for an event quote. Split in whole sen with 50% rounded up for deposit and the remainder as balance. Both must be positive. The merchant chooses the actual commercial price. |

## 14. BRD functional coverage

Baseline: [BRD 1.0-R2, signed by zwong](../BRD/SweetCommerce/BRD-SweetCommerce.md) including DEC-020 and DEC-021. This crosswalk is the shared inventory for PRD, SA and SD. “1”, “2” and “Shared” identify where documented behavior is delivered, not implementation or approval. Each PRD detail row supplies acceptance and UAT references. SA links the logical flows; SD links the concrete operations, state/data effects and verification by feature. Grouped source IDs preserve the signed BRD's grouping. No approved later capability is treated as an omission or as delivered v1 behavior.

| Approved source | Functional obligation | PRD / acceptance owner | SA flow | SD evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| BRD §§4,8; BR-CHK-001; DEC-014 | Login required for both customer journeys and access is account scoped | FN-ACC-01–02 | [SA-F01](../SA/diagrams/SA-F01.puml) | [SD-F01](../SD/diagrams/SD-F01.puml) | 1 |
| BR-CART-001–008 | Editable persistent cart; no allocation; revalidate at commitment; consume once at acceptance | FN-CART-01–03, FN-ORD-01 | [SA-F01](../SA/diagrams/SA-F01.puml) | [SD-F01](../SD/diagrams/SD-F01.puml) | 1 |
| BR-CAT-001–008, BR-CAT-010; BR-CUS-001–002 | Catalogue lifecycle, category, fixed options, prices, lead time, photo display and preserved order history | FN-CAT-01–04 | [SA-F02A](../SA/diagrams/SA-F02A.puml) | [SD-F02A](../SD/diagrams/SD-F02A.puml) | 1; photo interaction is a candidate refinement |
| BR-CAT-009; BR-CUS-003–006; DEC-003–004 | Free customization, blessing text and related fees | PRD §10 | — | — | Deferred: Later |
| BR-PRE-001–007; DEC-001–002 | MYT online intake, operating/closure calendar, standard same-day 18:00/21:00, event 7 days/22:00 | FN-CAL-01, FN-CAL-03, FN-EVT-01 | [SA-F02B](../SA/diagrams/SA-F02B.puml), [SA-F05](../SA/diagrams/SA-F05.puml) | [SD-F02B](../SD/diagrams/SD-F02B.puml), [SD-F05](../SD/diagrams/SD-F05.puml) | 1 and 2 |
| BR-CAP-001–005; DEC-005 | Daily/product caps; count all modes; closure impact; release unused but retain used capacity | FN-CAL-01–04 | [SA-F02B](../SA/diagrams/SA-F02B.puml) | [SD-F02B](../SD/diagrams/SD-F02B.puml) | 1 |
| BR-CAP-006–007 | DuitNow hold/expiry, timely review, Cash and fee waiting without hold | FN-CAL-04, FN-PAY-01–04, FN-ORD-05 | [SA-F04](../SA/diagrams/SA-F04.puml) | [SD-F04](../SD/diagrams/SD-F04.puml) | 1 |
| BR-CAP-008; BR-EVT-002; BRD §18 | Manually assess shared kitchen/staff/travel/setup/equipment; record and consult window; adjust standard capacity | FN-EVT-02–03, FN-CAL-01 | [SA-F05](../SA/diagrams/SA-F05.puml) | [SD-F05](../SD/diagrams/SD-F05.puml) | 2 with shared capacity |
| BR-DEL-001–010, BR-DEL-012–014; DEC-006–008, DEC-016–018 | Three fulfilment options, one delivery address, manual fee, customer pays own transport, pickup and driver events, incidents/consent | FN-ORD-03–08 | [SA-F03](../SA/diagrams/SA-F03.puml) | [SD-F03](../SD/diagrams/SD-F03.puml) | 1 |
| BR-DEL-011; INT-004 | External Lalamove arrangement now; automated integration later | FN-ORD-04–06; PRD §10 | [SA-F03](../SA/diagrams/SA-F03.puml) | [SD-F03](../SD/diagrams/SD-F03.puml) | 1 manual; automated Deferred: Later |
| BR-CHK-002–008 | Review complete captured details, consent/amount and paid-edit guard; one order with historical snapshot | FN-ORD-01–02, FN-CART-03 | [SA-F03](../SA/diagrams/SA-F03.puml) | [SD-F03](../SD/diagrams/SD-F03.puml) | 1 |
| BR-ORD-001–010; BRD §9 | Role-scoped queries, unique record, state/history, standard and event separation; cancellation and refund | FN-ORD-02, FN-ORD-06–08, FN-PAY-05–06, FN-EVT-04, FN-EVT-07, FN-ADM-03 | [SA-F03](../SA/diagrams/SA-F03.puml), [SA-F04](../SA/diagrams/SA-F04.puml), [SA-F06](../SA/diagrams/SA-F06.puml), [SA-F08](../SA/diagrams/SA-F08.puml) | [SD-F03](../SD/diagrams/SD-F03.puml), [SD-F04](../SD/diagrams/SD-F04.puml), [SD-F06](../SD/diagrams/SD-F06.puml), [SD-F08](../SD/diagrams/SD-F08.puml) | 1 and 2 |
| BR-PAY-001–009; DEC-009–013, DEC-022, DEC-025 (standard) | Manual DuitNow QR, proof vs verified funds, 30-minute top-up hold and review, Cash pickup/no-show, after-transfer WhatsApp follow-up, refund/exception | FN-PAY-01–06 | [SA-F04](../SA/diagrams/SA-F04.puml) | [SD-F04](../SD/diagrams/SD-F04.puml) | 1 |
| BR-EVT-001; BO-003; BRD §4; DEC-019 | Separate owned event intake, exact details and one application per submitted intent | FN-EVT-01, FN-EVT-04 | [SA-F05](../SA/diagrams/SA-F05.puml) | [SD-F05](../SD/diagrams/SD-F05.puml) | 2 |
| BR-EVT-003–004, BR-EVT-007; BR-PAY-010; DEC-020, DEC-028–029 | Quote minimum and positive instalments, current consent, deposit deadline and timely-proof hold, shortfall without deadline reset | FN-EVT-03–05 | [SA-F05](../SA/diagrams/SA-F05.puml), [SA-F06](../SA/diagrams/SA-F06.puml) | [SD-F05](../SD/diagrams/SD-F05.puml), [SD-F06](../SD/diagrams/SD-F06.puml) | 2 |
| BR-PAY-011; DEC-021, DEC-026–028 | Original balance and grace, proof review, verified shortfall, nonpayment guard, late verification and reschedule timing | FN-EVT-06–07 | [SA-F06](../SA/diagrams/SA-F06.puml) | [SD-F06](../SD/diagrams/SD-F06.puml) | 2 |
| BRD §10.2 (event); DEC-023–024 | Free before transfer including after quote acceptance, paid customer cancellation blocked, merchant full refund if unable to fulfil | FN-EVT-04, FN-EVT-07 | [SA-S02](../SA/diagrams/SA-S02.puml) | [SD-S02](../SD/diagrams/SD-S02.puml) | 2; customer-cancellation timing superseded by DEC-023–024 |
| BR-EVT-005–007; BR-PAY-012 | Setup/teardown and equipment out/check; itemized extras and DuitNow due two days after actual event end | FN-EVT-08–09 | [SA-F06](../SA/diagrams/SA-F06.puml) | [SD-F06](../SD/diagrams/SD-F06.puml) | 2 |
| BR-ADM-001–010; BRD §11 | Dedicated administrator, verified recovery, domain actions, queues, audit and sales summary | FN-ADM-01–04 and domain operation rows | [SA-F08A](../SA/diagrams/SA-F08A.puml), [SA-F08](../SA/diagrams/SA-F08.puml) | [SD-F08A](../SD/diagrams/SD-F08A.puml), [SD-F08](../SD/diagrams/SD-F08.puml) | 1 and Shared; all-channel loss procedure → launch |
| BR-ADM-011; BRD §4 Later | Multiple staff roles and other listed Later capabilities | PRD §10 | — | — | Deferred: Later |
| BR-NOT-001–006; INT-002; DEC-015; BRD §12 | All standard/event and merchant milestones; optional email, primary/fallback channel, retry and manual follow-up | FN-ACC-01, FN-ORD-04, FN-EVT-01, FN-NOT-01–03 | [SA-F07](../SA/diagrams/SA-F07.puml) | [SD-F07](../SD/diagrams/SD-F07.puml) | Shared; OTP needed in 1 |
| BR-RPT-001–005, BR-RPT-007; BO-002, BO-004–006 | Counts/status and production demand; receipts/refunds/net by actual MYT movement and category; monthly KPIs | FN-ADM-04–05, FN-ORD-06 | [SA-F08](../SA/diagrams/SA-F08.puml) | [SD-F08](../SD/diagrams/SD-F08.puml) | Shared |
| BR-RPT-006; BRD §4 Later | Top-seller analysis, advanced reports and export | PRD §10 | — | — | Deferred: Later |
| NFR-001–002, NFR-010–011 | Continuous intake, mobile core journeys, accessibility, browser and performance acceptance | FN-CAL-01; PRD §7 | [SA-F02](../SA/diagrams/SA-F02.puml), [SA-F08](../SA/diagrams/SA-F08.puml) | [SD-F02](../SD/diagrams/SD-F02.puml), [SD-F08](../SD/diagrams/SD-F08.puml) | Design/UAT; targets and runtime evidence separate |
| NFR-003–008; BRD §16 | Owner/admin isolation, proof restriction, consistency, no duplicate effects, immutable snapshots and failure history | FN-ACC-02, FN-CAL-04, FN-ORD-02, FN-PAY-02–06, FN-NOT-03, FN-ADM-03 | [SA-F01](../SA/diagrams/SA-F01.puml), [SA-F03](../SA/diagrams/SA-F03.puml), [SA-F04](../SA/diagrams/SA-F04.puml), [SA-F07](../SA/diagrams/SA-F07.puml), [SA-F08](../SA/diagrams/SA-F08.puml) | [SD-F01](../SD/diagrams/SD-F01.puml), [SD-F03](../SD/diagrams/SD-F03.puml), [SD-F04](../SD/diagrams/SD-F04.puml), [SD-F07](../SD/diagrams/SD-F07.puml), [SD-F08](../SD/diagrams/SD-F08.puml) | 1 and Shared |
| NFR-009, NFR-012; BRD §§16,18,20.3 | Backup and restore, access/retention/deletion and owner handling; validate actual setup, funds and providers | FN-ADM-06–07 | [SA-F08](../SA/diagrams/SA-F08.puml) | [SD-F08](../SD/diagrams/SD-F08.puml) | Launch evidence and owner policy pending |
| INT-001, INT-003 | DuitNow/Cash and manual delivery eligibility/fee boundaries | FN-PAY-01–06, FN-ORD-04–05 | [SA-F03](../SA/diagrams/SA-F03.puml), [SA-F04](../SA/diagrams/SA-F04.puml) | [SD-F03](../SD/diagrams/SD-F03.puml), [SD-F04](../SD/diagrams/SD-F04.puml) | 1; actual channels Launch |
| BRD §§4,4.1; BO-001, BO-005, BO-007 | Web customer/admin scope, Gather Dessert branding and visibility; explicit exclusions | PRD §§1,9,10; FN-ORD-07, FN-EVT-04, FN-ADM-03 | [SA-02](../SA/diagrams/SA-02.puml), [SA-F08](../SA/diagrams/SA-F08.puml) | [SD-A01](../SD/diagrams/SD-A01.puml), [SD-F08](../SD/diagrams/SD-F08.puml) | 1 and 2; excluded items remain outside v1 |

| BRD rules | Functional enforcement checked |
| --- | --- |
| RULE-001–005 | FN-CAL-01–04 and FN-EVT-01–02 enforce same-day/lead-time, closure and shared production rules. FN-ORD-03–05 and FN-EVT-03 preserve the distinct fulfilment paths. |
| RULE-006–008 | FN-ORD-01–02, FN-ORD-05 and FN-CAT-03–04 enforce prepayment amount consent, historical snapshots and new-order sellability. |
| RULE-009 | FN-ORD-02, FN-CART-03 and FN-PAY-03/06 enforce one checkout/order and one receipt/refund per effect. |
| RULE-010–011 | FN-ORD-08, FN-PAY-05/06 and FN-EVT-07 enforce cancellation, reschedule and unused-resource disposition within approved rules. |
| RULE-012–013 | FN-ORD-05 and FN-PAY-06 enforce manual delivery confirmation before charging and cap refunds at verified refundable receipts. |
| RULE-014–015 | FN-ADM-03, FN-ACC-01–02 and FN-CART-02 enforce history and verified account ownership across devices. |
| RULE-016 | FN-ORD-02 and FN-EVT-04–09 keep order/event checkout and event deposit, original balance and extras separate. |

BRD §20.2 UAT-001–020 are retained across the detailed catalogue. Release sign-off is controlled by BRD §20.3. Unresolved policy is listed in the [SD Index review register](../SD/SD-SweetCommerce-index.md#review-and-approval).
