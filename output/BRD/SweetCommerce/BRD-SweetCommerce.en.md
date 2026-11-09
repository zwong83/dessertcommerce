# SweetCommerce — Business Requirements Document (BRD)

Business Requirements Document · Version 1.0-R1 · Refactored Draft for Merchant Review

## Document Control

| Field | Details |
| --- | --- |
| Project | SweetCommerce |
| Business Type | Dessert Pre-Order E-Commerce |
| Sales Model | Pre-Order Only |
| Fulfilment | Delivery Only |
| Currency | MYR — Proposed |
| Target Market | Malaysia — Proposed |
| Document Status | Draft — Pending Business Approval |
| Original Document Date | 5 November 2026 |
| Refactored Date | 6 November 2026 |
| Business Owner | TBC |
| Document Author | TBC |
| Named Reviewers | TBC |
| Prepared For | Dessert Business Owner & Development Team |
| Delivery Approach | MVP → Enhancement → Scale — Proposed |

### Version History

| Version | Date | Change | Approval Status |
| --- | --- | --- | --- |
| 1.0 | 5 November 2026 | Initial BRD draft | Pending Approval |
| 1.0-R1 | 6 November 2026 | Restructured requirements, normalized statuses, and added module-level workflows, rules, exceptions, acceptance criteria, integrations, assumptions, and quality gates | Pending Approval |

### Status Model

This BRD separates three independent dimensions:

| Dimension | Allowed Values | Meaning |
| --- | --- | --- |
| Priority | Must / Should / Could / Won't for this phase | Business importance for the stated release |
| Decision / Evidence Status | Confirmed / Proposed / Assumption / TBC / Open / Pending Approval | Whether a statement is evidenced, proposed, unresolved, or approved |
| Delivery Status | MVP / Later / Named phase | Intended delivery window |

`Must` indicates importance, not approval. A Must requirement marked `TBC` or `Pending Approval` is not a final development commitment.

### Confirmed Facts and Document Status

The source BRD confirms only the following business facts:

| Fact ID | Confirmed Fact | Status |
| --- | --- | --- |
| FACT-001 | SweetCommerce sells desserts using a pre-order model. | Confirmed |
| FACT-002 | Initial-scope orders are fulfilled through delivery only; Self Pickup is not supported. | Confirmed |

All other markets, currencies, targets, workflows, channels, estimates, and policy details remain `Proposed`, `TBC`, `Open`, or `Pending Approval` until formally approved by the Business Owner.

# 1. Executive Summary

## 1.1 Business Context

SweetCommerce is a proposed online dessert pre-order and delivery management platform. It is intended to bring customer ordering and merchant fulfilment into one coordinated and traceable business flow.

The proposed platform contains two business-facing experiences:

- **Customer Storefront** — customers browse desserts, choose variants and permitted customizations, select an eligible delivery date and time slot, place an order, complete the approved payment process, and check order status.
- **Merchant Administration Portal** — authorized staff manage products, pre-order rules, production capacity, orders, payment status, delivery arrangements, and basic sales reporting.

## 1.2 Problem or Opportunity

The following are hypotheses from the source BRD and require merchant interviews and operational evidence. They are not confirmed statements about the merchant's current process.

| Potential Problem | Potential Business Impact | Evidence Status |
| --- | --- | --- |
| Orders are recorded manually | Orders may be missed or recorded more than once | Assumption |
| Customers repeatedly ask for product and price information | Customer-service workload may increase | Assumption |
| Delivery dates are checked manually | Date conflicts may occur | Assumption |
| Production capacity is not controlled systematically | The merchant may accept more work than it can fulfil | Assumption |
| Payment records are distributed across channels | Payment confirmation and reconciliation may be difficult | Assumption |
| Order status is not managed in one place | Production and delivery progress may be difficult to track | Assumption |
| Sales information is not consolidated | Best-selling products and revenue may be difficult to analyse | Assumption |

## 1.3 Proposed Business Outcome

Create a unified dessert pre-order platform that supports the complete business journey from product discovery to delivery completion while protecting production capacity and maintaining traceable order and payment records.

## 1.4 Proposed End-to-End Business Workflow

1. The customer browses available desserts.
2. The customer selects a product variant and permitted customization options.
3. The customer chooses an eligible delivery date, time slot, and address.
4. The platform validates price, availability, production capacity, and delivery eligibility.
5. The customer confirms checkout and follows the approved payment process.
6. The merchant confirms or rejects the order according to approved policy.
7. The merchant prepares the order and coordinates delivery.
8. Authorized staff update delivery status until completion or a recorded exception.

The sequence between payment, merchant confirmation, and capacity reservation is `TBC` and must be resolved through DEC-010 and related decisions.

## 1.5 Scope and Release Summary

The proposed MVP covers a single-merchant web storefront and merchant portal for pre-order desserts with delivery-only fulfilment. Marketplace, native mobile apps, loyalty, advanced routing, and full inventory or cost accounting are outside the initial MVP.

# 2. Business Objectives and Success Metrics

## 2.1 Business Objectives

| ID | Business Objective | Proposed Success Measure | Decision Status |
| --- | --- | --- | --- |
| BO-001 | Establish an online pre-order channel | Customers can complete an eligible pre-order without manual merchant re-entry | Proposed |
| BO-002 | Reduce manual order intake | At least 70% of standard orders are completed online | Proposed; baseline TBC |
| BO-003 | Reduce missed or duplicate orders | Every accepted online order has one unique order number | Proposed |
| BO-004 | Prevent overbooking | The platform does not accept orders beyond approved production capacity | Proposed; capacity model TBC |
| BO-005 | Improve order-processing efficiency | Standard orders do not require duplicate merchant entry | Proposed |
| BO-006 | Provide sales visibility | Merchant can view agreed daily and monthly sales measures | Proposed |
| BO-007 | Improve customer visibility | Customer can securely check current order status | Proposed |

## 2.2 KPI Register

| KPI | Proposed Definition | Baseline | Target | Measurement Owner | Status |
| --- | --- | --- | --- | --- | --- |
| Online Order Conversion Rate | Completed online orders divided by eligible checkout starts | TBC | TBC | TBC | Proposed |
| Successful Order Rate | Accepted orders divided by submitted orders | TBC | TBC | TBC | Proposed |
| Order Cancellation Rate | Cancelled orders divided by accepted orders | TBC | TBC | TBC | Proposed |
| Payment Confirmation Time | Time from payment initiation or evidence submission to confirmation | TBC | TBC | TBC | Proposed |
| On-Time Delivery Rate | Delivered orders completed within the approved window | TBC | TBC | TBC | Proposed |
| Average Order Value | Confirmed order value divided by confirmed orders | TBC | TBC | TBC | Proposed |
| Repeat Customer Rate | Returning identifiable customers divided by identifiable customers | TBC | TBC | TBC | Proposed |
| Merchant Order Processing Time | Time from order visibility to merchant action | TBC | TBC | TBC | Proposed |

## 2.3 Baseline and Measurement Method

- BO-002's 70% target is a proposal and requires current-channel baseline data.
- Metrics must distinguish order creation, merchant acceptance, payment confirmation, refund, cancellation, and delivery completion.
- Metric owners, reporting periods, time zone, and calculation rules are `TBC`.

# 3. Stakeholders and User Roles

## 3.1 Stakeholder Register

| Stakeholder | Responsibilities | Decision Rights | Status |
| --- | --- | --- | --- |
| Business Owner | Confirms business rules, pricing, cancellation, refund, delivery, and release scope | Final business approval | Proposed role; named owner TBC |
| Shop Administrator | Manages products, orders, availability, and operational schedules | Operational changes within approved policy | Proposed |
| Production Staff | Reviews production demand and updates preparation progress | Production status updates | Proposed |
| Delivery Personnel | Views authorized delivery details and updates delivery progress | Delivery status updates | Proposed |
| Customer | Browses, orders, pays through approved channels, and checks status | Confirms order information and payment action | Proposed |
| System Administrator | Maintains platform access, configuration, and security | Technical administration within approved controls | Proposed |

## 3.2 Responsibilities and Decision Rights

- The Business Owner approves the business decisions and sign-offs in Section 21.
- For MVP, one Merchant Administrator may perform Shop Administrator, Production Staff, and delivery-coordination duties.
- Granular multi-staff RBAC is Later unless the merchant identifies a pre-launch separation-of-duties requirement.

## 3.3 Communication and Approval Needs

- Development and test teams may use this document as a review draft but must not treat Proposed or TBC items as approved scope.
- Operational staff should review workflows, exception scenarios, and UAT.
- Policies affecting payment, refunds, capacity, delivery, and personal information require approval before commercial launch.

# 4. Project Scope

## 4.1 In Scope — Proposed MVP

| Module | Proposed Capability | Decision Status | Delivery Status |
| --- | --- | --- | --- |
| Product Catalog | Product display, categories, variants, prices, and images | Proposed | MVP |
| Product Customization | Approved greeting text, flavours, and add-ons | Proposed / TBC | MVP |
| Pre-Order | Lead-time rules and eligible delivery-date selection | Proposed | MVP |
| Production Capacity | Daily or slot-based capacity control | Model TBC | MVP |
| Delivery | Address, service area, fee, date, and time slot | Delivery-only Confirmed; details TBC | MVP |
| Shopping Cart | Add, modify, and remove items | Proposed | MVP |
| Checkout | Order review and proposed Guest Checkout | Identity model TBC | MVP |
| Payment | Approved collection and payment-confirmation process | TBC | MVP |
| Order Management | Order creation, lookup, status, and history | Proposed | MVP |
| Merchant Administration | Product, order, production, payment, and delivery operations | Proposed | MVP |
| Notification | Basic order and status notifications | Channel TBC | MVP |
| Reporting | Basic order and sales measures | Proposed | MVP |
| Security and Privacy | Administrator authentication and protected customer order access | Proposed | MVP |

## 4.2 Out of Scope — Proposed Initial MVP

- Multi-merchant marketplace.
- Multi-warehouse management.
- Cross-border sales and multiple currencies.
- Full point-of-sale system.
- Loyalty points and referral programme.
- AI product recommendations and AI customer-service agent.
- Automated route optimization and merchant-owned rider dispatch.
- Raw-material procurement and full cost accounting.
- Native iOS or Android applications.

## 4.3 Release Boundaries

- The initial release is proposed as a single-merchant web MVP.
- Capabilities marked `Later` are not part of the initial release gate.
- New requests affecting payment, refunds, capacity, fulfilment, personal information, or launch timing require change assessment under Section 21.4.

## 4.4 Scope Assumptions

- Target market is Malaysia — Proposed.
- Currency is MYR — Proposed.
- One merchant business operates the MVP — Assumption.
- A small merchant team can initially share operational responsibilities — Assumption.

# 5. Functional Business Requirements

## 5.1 Capability Overview

This section covers Product Catalog and Product Customization. Pre-order, delivery, checkout, order, payment, administration, notification, and reporting are covered in Sections 6–13.

## 5.2 Product Catalog Management

### 5.2.1 Business Objective

Provide customers with accurate, current product information while allowing the merchant to control which products and variants can receive new orders.

### 5.2.2 Actors and Responsibilities

- Shop Administrator maintains products, variants, prices, images, preparation time, and availability.
- Customer sees only products and variants currently eligible for new orders.

### 5.2.3 Business Workflow

1. Administrator creates or updates a product.
2. Administrator defines at least one sellable variant and valid price.
3. Administrator configures images, preparation time, and optional choices.
4. Administrator publishes, unpublishes, pauses, marks sold out, or archives the product.
5. Storefront displays only products eligible for new orders.

### 5.2.4 Requirements

| ID | Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| BR-CAT-001 | Shop Administrator can create a product. | Must | Proposed | MVP |
| BR-CAT-002 | Shop Administrator can edit product name, description, and category. | Must | Proposed | MVP |
| BR-CAT-003 | A product can have multiple variants with different prices. | Must | Proposed | MVP |
| BR-CAT-004 | Shop Administrator can publish and unpublish a product. | Must | Proposed | MVP |
| BR-CAT-005 | Customers can view only products currently available for sale. | Must | Proposed | MVP |
| BR-CAT-006 | A product can display multiple images. | Must | Proposed | MVP |
| BR-CAT-007 | Shop Administrator can archive a product without losing historical order references. | Must | Proposed | MVP |
| BR-CAT-008 | A product can have a preparation lead time. | Must | Proposed | MVP |
| BR-CAT-009 | A product can offer merchant-configured flavours or add-ons. | Should | Proposed | MVP |
| BR-CAT-010 | Shop Administrator can mark a product sold out or temporarily unavailable. | Must | Proposed | MVP |

### 5.2.5 Business Rules

- A product requires a name and at least one valid sellable variant before publication.
- Every sellable variant requires a valid price.
- An unpublished, sold-out, paused, or archived product cannot be used for a new order.
- Product and price changes must not alter historical order values.

### 5.2.6 Exceptions and Failure Scenarios

- Publication is rejected when mandatory information is missing.
- A product becoming unavailable during checkout triggers revalidation.
- Archiving does not remove a product from existing order records.

### 5.2.7 Acceptance Criteria

- Only published and available products appear to customers.
- Each displayed variant shows the price currently applicable to a new order.
- Historical orders retain the product and price snapshot that applied at order creation.
- A paused or archived product cannot be added to a new order.

### 5.2.8 Dependencies and Open Decisions

- Depends on merchant-supplied product, pricing, image, lead-time, and option data.
- Related decisions: DEC-003 and DEC-004.

## 5.3 Product Customization

### 5.3.1 Business Objective

Allow customers to request only merchant-approved and fulfilable customizations, with all additional charges visible before checkout.

### 5.3.2 Actors and Responsibilities

- Shop Administrator configures available options, limits, and charges.
- Customer selects or enters permitted customization information.
- Merchant reviews the accepted customization details during fulfilment.

### 5.3.3 Business Workflow

1. Customer chooses a product variant.
2. Storefront displays only options enabled for that product.
3. Customer selects options or enters permitted greeting text.
4. Additional charges appear in the order review.
5. The accepted order preserves confirmed customization details.

### 5.3.4 Requirements

| ID | Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| BR-CUS-001 | Customer can choose an available product variant. | Must | Proposed | MVP |
| BR-CUS-002 | Customer can choose merchant-configured flavours when enabled. | Should | TBC | MVP |
| BR-CUS-003 | Customer can enter greeting text when enabled. | Should | TBC | MVP |
| BR-CUS-004 | Merchant can define an allowed greeting-text length. | Should | TBC | MVP |
| BR-CUS-005 | An approved customization option can add a charge. | Should | Proposed | MVP |
| BR-CUS-006 | An accepted order preserves confirmed customization details when enabled. | Must | Proposed | MVP |

### 5.3.5 Business Rules

- Customer may choose only options currently allowed for the product.
- Additional charges must be visible before order submission.
- Unsupported free-form requests are not automatically accepted.
- Whether customization can change after confirmation is `TBC`.

### 5.3.6 Exceptions and Failure Scenarios

- Invalid or unavailable options are rejected during cart and checkout validation.
- Text exceeding the approved limit is rejected with a clear message.
- Post-confirmation changes follow DEC-018.

### 5.3.7 Acceptance Criteria

- A customer cannot select an option not configured for the product.
- Extra charges appear in the item amount and final order total.
- Merchant order details match the customization accepted at checkout.

### 5.3.8 Dependencies and Open Decisions

- Depends on DEC-003, DEC-004, and DEC-018.
- Flavour, greeting text, modification deadline, and unsupported-request policy remain open.

# 6. Pre-Order and Production Capacity

## 6.1 Business Objective

Accept only orders that satisfy approved lead-time, operating-calendar, delivery-slot, and production-capacity rules.

## 6.2 Actors and Responsibilities

- Shop Administrator configures lead times, cut-offs, closed dates, special schedules, and capacity.
- Customer chooses from eligible delivery dates and slots.
- Platform prevents accepted orders from exceeding approved capacity.

## 6.3 Business Workflow

1. Customer selects products and a delivery date.
2. Platform checks lead time, cut-off, calendar, slot, and capacity.
3. Only eligible dates and slots remain selectable.
4. Capacity is reserved or consumed according to approved order and payment policy.
5. Cancellation, rejection, expiry, or authorized adjustment releases capacity according to approved rules.

## 6.4 Requirements

| ID | Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| BR-PRE-001 | Merchant can configure the minimum advance-order period. | Must | Proposed | MVP |
| BR-PRE-002 | Customer can choose only delivery dates that satisfy approved rules. | Must | Proposed | MVP |
| BR-PRE-003 | Merchant can close a specified date to new orders. | Must | Proposed | MVP |
| BR-PRE-004 | Platform validates product and date eligibility before accepting an order. | Must | Proposed | MVP |
| BR-PRE-005 | Different products can have different preparation times. | Must | Proposed | MVP |
| BR-PRE-006 | Merchant can configure an order cut-off time when approved. | Should | TBC | MVP |
| BR-PRE-007 | Merchant can configure holidays and special schedules. | Should | Proposed | MVP |
| BR-CAP-001 | Merchant can configure capacity using the approved capacity unit. | Must | TBC | MVP |
| BR-CAP-002 | Platform validates capacity before accepting an order. | Must | Proposed | MVP |
| BR-CAP-003 | Concurrent submissions cannot cause accepted orders to exceed capacity. | Must | Proposed | MVP |
| BR-CAP-004 | Cancellation or rejection releases capacity according to approved policy. | Must | TBC | MVP |
| BR-CAP-005 | Authorized merchant staff can adjust future available capacity. | Should | Proposed | MVP |
| BR-CAP-006 | A temporary capacity hold expires and is released when that model is approved. | Must | TBC | MVP |

## 6.5 Business Rules

- Earliest delivery date depends on lead time, cut-off, operating days, closed dates, delivery slots, and capacity.
- Capacity may be measured by order count, dessert quantity, product quota, or production effort; DEC-005 selects the model.
- Capacity consumption must follow the approved payment and merchant-confirmation sequence.

## 6.6 Exceptions and Failure Scenarios

- A date or capacity becomes unavailable during checkout.
- Multiple customers attempt to book the final capacity.
- Merchant closes a date already used by existing carts.
- An order expires, is rejected, or is cancelled after capacity was held.
- Merchant reduces future capacity below already committed demand.

## 6.7 Acceptance Criteria

- An ineligible or closed delivery date cannot be selected.
- The last available capacity can be accepted only once.
- Checkout revalidates eligibility and capacity before creating the order.
- Capacity is released only under approved cancellation, rejection, or expiry conditions.

## 6.8 Dependencies and Open Decisions

- Depends on DEC-001, DEC-002, DEC-005, DEC-008, DEC-010, DEC-012, and DEC-018.
- Lead time, cut-off, capacity unit, reservation timing, expiry, release, and override rules remain open.

# 7. Delivery Management

## 7.1 Business Objective

Fulfil every accepted order through an approved service area, fee model, date, and time slot while protecting customer information and recording delivery exceptions.

## 7.2 Actors and Responsibilities

- Customer provides accurate contact, address, slot, and permitted notes.
- Shop Administrator configures service areas, fees, and slots.
- Delivery Personnel views only necessary delivery details and updates status.

## 7.3 Business Workflow

1. Customer enters delivery information.
2. Platform validates service area and available slot.
3. Approved delivery fee is included in the final order total.
4. Merchant prepares and hands off the order for delivery.
5. Authorized staff update delivery status through completion or exception.

## 7.4 Requirements

| ID | Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| BR-DEL-001 | Customer must provide a delivery address. | Must | Confirmed at policy level | MVP |
| BR-DEL-002 | Customer must provide a delivery contact name and telephone number. | Must | Proposed | MVP |
| BR-DEL-003 | Customer can choose an available delivery date. | Must | Confirmed at policy level; details TBC | MVP |
| BR-DEL-004 | Customer can choose an available delivery slot. | Must | TBC | MVP |
| BR-DEL-005 | Platform validates whether the address is in the approved service area. | Must | Proposed | MVP |
| BR-DEL-006 | Platform calculates the delivery fee using the approved model. | Must | TBC | MVP |
| BR-DEL-007 | Checkout displays product total, delivery fee, and final amount. | Must | Proposed | MVP |
| BR-DEL-008 | Authorized merchant staff can update delivery status. | Must | Proposed | MVP |
| BR-DEL-009 | Customer can securely view delivery status. | Must | Proposed | MVP |
| BR-DEL-010 | Customer can provide permitted notes such as unit or floor information. | Should | Proposed | MVP |
| BR-DEL-011 | Platform may integrate with a third-party delivery provider. | Could | TBC | Later |

## 7.5 Scheduling and Fee Rules

| Fee Model | Description | Standing |
| --- | --- | --- |
| Flat Rate | One fee for all approved areas | Candidate option |
| Zone-Based | Fee configured by zone or postcode | Proposed starting point |
| Distance-Based | Fee calculated by distance | Candidate option; external dependency likely |
| Manual Quote | Merchant confirms the fee before accepting the order | Candidate option |

Zone-Based delivery is a proposed MVP starting point, not an approved decision.

## 7.6 Exceptions and Failure Scenarios

- Incorrect or incomplete address.
- Recipient cannot be contacted.
- Customer requests an address change.
- Delivery cannot arrive within the selected window.
- Dessert is damaged during delivery.
- Delivery fails and redelivery may be required.
- Charges, refunds, liability, and customer communication remain subject to merchant approval.

## 7.7 Acceptance Criteria

- Self Pickup is not available in the initial scope.
- An order cannot be accepted without required delivery information.
- An ineligible area is rejected or follows the approved manual-quote process.
- Final checkout shows the approved delivery fee before submission.
- Delivery failure is recorded without losing order or payment history.

## 7.8 Dependencies and Open Decisions

- Depends on DEC-006, DEC-007, DEC-008, DEC-013, DEC-017, and DEC-018.
- Service area, fee, slots, delivery operator, redelivery, liability, and address-change deadline remain open.

# 8. Shopping Cart and Checkout

## 8.1 Business Objective

Allow a customer to assemble and submit an order once using current product, price, pre-order, capacity, and delivery rules.

## 8.2 Actors and Responsibilities

- Customer manages cart contents and confirms checkout information.
- Platform revalidates rules and creates one order for one accepted submission.
- Merchant receives a complete order record for fulfilment.

## 8.3 Business Workflow

1. Customer adds products, variants, and customizations.
2. Customer changes quantity or removes items.
3. Customer enters contact and delivery information.
4. Checkout recalculates price, fees, availability, eligibility, and capacity.
5. Customer reviews and submits the order.
6. Platform creates a unique order and displays the next step.

## 8.4 Requirements

| ID | Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| BR-CART-001 | Customer can add an available configured item to the cart. | Must | Proposed | MVP |
| BR-CART-002 | Customer can change quantity subject to current rules. | Must | Proposed | MVP |
| BR-CART-003 | Customer can remove a cart item. | Must | Proposed | MVP |
| BR-CART-004 | Cart shows the current indicative item total. | Must | Proposed | MVP |
| BR-CART-005 | Checkout revalidates product availability. | Must | Proposed | MVP |
| BR-CART-006 | Checkout revalidates price, options, delivery, and pre-order eligibility. | Must | Proposed | MVP |
| BR-CHK-001 | Platform supports Guest Checkout if DEC-014 is approved. | Must | TBC | MVP |
| BR-CHK-002 | Checkout collects customer name and contact number. | Must | Proposed | MVP |
| BR-CHK-003 | Checkout collects delivery address, date, and approved slot. | Must | Proposed | MVP |
| BR-CHK-004 | Checkout displays the final order breakdown. | Must | Proposed | MVP |
| BR-CHK-005 | Customer confirms order information before submission. | Must | Proposed | MVP |
| BR-CHK-006 | Repeated submission of the same checkout does not create duplicate orders. | Must | Proposed | MVP |
| BR-CHK-007 | Every accepted order receives a unique order number. | Must | Proposed | MVP |
| BR-CHK-008 | Accepted order preserves confirmed product, price, delivery, and customization details. | Must | Proposed | MVP |

## 8.5 Business Rules

- Cart prices and availability are indicative until checkout validation succeeds.
- The platform-controlled final calculation is authoritative for the submitted order.
- Failed validation requires the customer to review affected items or delivery details.

## 8.6 Exceptions and Failure Scenarios

- Product, price, option, date, slot, area, or capacity changes before submission.
- Customer submits the same checkout more than once.
- Payment or merchant confirmation does not complete after order creation.
- Customer cannot reopen the confirmation page.

## 8.7 Acceptance Criteria

- Checkout clearly identifies invalid items or information.
- One accepted submission produces one order number.
- Final order values match the accepted checkout breakdown.
- Customer can securely retrieve order status under the approved identity model.

## 8.8 Dependencies and Open Decisions

- Depends on product, capacity, delivery, payment, notification, and identity decisions.
- DEC-014, order-access verification, cart retention, and order-expiry rules remain open.

# 9. Order Management

## 9.1 Business Objective

Maintain one traceable order record from submission through preparation, delivery, completion, cancellation, rejection, or failure.

## 9.2 Actors and Responsibilities

- Merchant reviews and processes orders.
- Production and delivery roles update authorized statuses.
- Customer securely views permitted order status.

## 9.3 Proposed Lifecycle

| State | Business Meaning | Decision Status |
| --- | --- | --- |
| PENDING_PAYMENT | Awaiting the approved payment action or confirmation | Proposed; sequence TBC |
| PENDING_CONFIRMATION | Awaiting merchant acceptance | Proposed; sequence TBC |
| CONFIRMED | Merchant has accepted the order | Proposed |
| PREPARING | Production has started | Proposed |
| READY_FOR_DELIVERY | Order is ready for delivery handoff | Proposed |
| OUT_FOR_DELIVERY | Order is in delivery | Proposed |
| DELIVERED | Delivery is complete | Proposed |
| CANCELLED | Order was cancelled under approved policy | Proposed |
| REJECTED | Merchant rejected the order | Proposed |
| EXPIRED | Required action was not completed in time | Proposed |
| DELIVERY_FAILED | Delivery could not be completed | Proposed |

Refund status is tracked separately from fulfilment status.

## 9.4 Requirements

| ID | Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| BR-ORD-001 | Platform creates one unique order for each accepted checkout submission. | Must | Proposed | MVP |
| BR-ORD-002 | Authorized merchant staff can view all merchant orders. | Must | Proposed | MVP |
| BR-ORD-003 | Authorized merchant staff can filter by relevant date and status. | Must | Proposed | MVP |
| BR-ORD-004 | Authorized merchant staff can view details needed for fulfilment. | Must | Proposed | MVP |
| BR-ORD-005 | Authorized merchant staff can confirm or reject an order under approved policy. | Must | Proposed | MVP |
| BR-ORD-006 | Authorized staff can update preparation progress. | Must | Proposed | MVP |
| BR-ORD-007 | Authorized staff can update delivery progress. | Must | Proposed | MVP |
| BR-ORD-008 | Customer can securely retrieve permitted order-status information. | Must | Proposed | MVP |
| BR-ORD-009 | Status changes retain actor, time, previous status, new status, and reason where required. | Must | Proposed | MVP |
| BR-ORD-010 | Cancellation and refund handling follow approved merchant policy. | Must | TBC | MVP |

## 9.5 Business Rules and Transitions

- Only approved transitions are allowed for the current state and actor.
- Merchant confirmation and payment sequence is `TBC`.
- Effects of cancellation, modification, expiry, rejection, and refund on capacity and payment must be defined before launch.

## 9.6 Exceptions and Failure Scenarios

- Merchant rejects an already-paid order.
- Customer requests cancellation or modification after production begins.
- Payment and order statuses disagree.
- Delivery fails after production handoff.
- An unauthorized actor attempts to update status.

## 9.7 Acceptance Criteria

- Every accepted order is searchable by its unique order number.
- Invalid or unauthorized status transitions are rejected.
- Status history remains available after cancellation, rejection, refund, or completion.
- A customer cannot retrieve another customer's order information.

## 9.8 Dependencies and Open Decisions

- Depends on DEC-009, DEC-010, DEC-012, DEC-013, DEC-014, DEC-017, and DEC-018.
- Final lifecycle, identity, cancellation, modification, rejection, refund, and delivery-failure handling remain open.

# 10. Payment Management

## 10.1 Business Objective

Record, confirm, and reconcile payments and refunds through merchant-approved methods without storing complete payment-card credentials.

## 10.2 Actors and Responsibilities

- Customer follows an approved payment method.
- Merchant reviews payment status and handles exceptions.
- Approved payment provider or manual process supplies payment evidence or confirmation.

## 10.3 Payment Options

| Option | Business Consideration | Standing |
| --- | --- | --- |
| Manual Bank Transfer / DuitNow | Lower initial cost but may require manual confirmation | Candidate option |
| Payment Gateway | More automated but requires fees, onboarding, and integration | Candidate option |
| Deposit / Partial Payment | May suit custom orders but increases policy and reconciliation complexity | Candidate option |
| Cash on Delivery | Requires approval and introduces rejection or collection risk | Candidate option |

## 10.4 Requirements

| ID | Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| BR-PAY-001 | Customer can use a merchant-approved payment method. | Must | TBC | MVP |
| BR-PAY-002 | Platform retains a payment record associated with the order. | Must | Proposed | MVP |
| BR-PAY-003 | Payment records distinguish pending, successful, failed, and other approved statuses. | Must | Proposed | MVP |
| BR-PAY-004 | Platform compares expected order amount with confirmed payment amount under approved rules. | Must | Proposed | MVP |
| BR-PAY-005 | Duplicate payment confirmations do not create duplicate recorded payments. | Must | Proposed | MVP |
| BR-PAY-006 | Authorized merchant staff can view payment status. | Must | Proposed | MVP |
| BR-PAY-007 | Refund actions and outcomes retain a traceable record. | Must | Proposed | MVP |
| BR-PAY-008 | Platform does not store complete payment-card credentials. | Must | Proposed | MVP |

## 10.5 Payment and Refund Lifecycle

- Payment and refund states, expiry, failed-payment recovery, and reconciliation are `TBC`.
- Development may simulate payment; commercial launch requires an approved real payment process.
- Refund status remains separate from order fulfilment status.

## 10.6 Exceptions and Failure Scenarios

- Customer pays an incorrect amount.
- A payment is confirmed more than once.
- Merchant rejects an already-paid order.
- Payment confirmation is delayed or unavailable.
- A partial or full refund is required.

## 10.7 Acceptance Criteria

- One payment event is recorded once even if confirmation is repeated.
- Merchant can distinguish unpaid, pending, paid, failed, and refunded outcomes under the approved model.
- A refund cannot exceed the refundable amount.
- Commercial launch does not rely on simulated payment.

## 10.8 Dependencies and Open Decisions

- Depends on DEC-009, DEC-010, DEC-011, DEC-012, DEC-013, and the selected payment process.
- Payment methods, full versus deposit payment, timing, rejection, refund, and reconciliation ownership remain open.

# 11. Merchant Administration Portal

## 11.1 Business Objective

Provide authorized merchant personnel with secure, traceable operational controls for the MVP.

## 11.2 Roles and Permissions

- One Merchant Administrator may perform multiple operational responsibilities in the MVP.
- Multiple staff accounts and granular permissions are Later scope unless separation of duties is confirmed as necessary before launch.
- Customer and merchant data access must remain segregated.

## 11.3 Requirements

| ID | Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| BR-ADM-001 | An authorized administrator can sign in. | Must | Proposed | MVP |
| BR-ADM-002 | An administrator can manage products and variants. | Must | Proposed | MVP |
| BR-ADM-003 | An administrator can manage prices and availability. | Must | Proposed | MVP |
| BR-ADM-004 | An administrator can manage pre-order dates and production capacity. | Must | Proposed; policy TBC | MVP |
| BR-ADM-005 | An administrator can manage delivery zones and fees. | Must | TBC | MVP |
| BR-ADM-006 | An administrator can view and process orders. | Must | Proposed | MVP |
| BR-ADM-007 | Authorized personnel can update production and delivery status. | Must | Proposed | MVP |
| BR-ADM-008 | An administrator can view payment status. | Must | Proposed | MVP |
| BR-ADM-009 | An administrator can view a daily order summary. | Must | Proposed | MVP |
| BR-ADM-010 | An administrator can view basic sales reports. | Should | Proposed | MVP |
| BR-ADM-011 | The merchant can manage multiple staff accounts and granular permissions. | Could | Proposed | Later |

## 11.4 Audit and Operational Views

Critical administrative actions should record the actor, time, action type, and relevant change details. Retention and review policies are `TBC`.

## 11.5 Exceptions and Failure Scenarios

- Administrator session is invalid or expired.
- An unauthorized user attempts an operation.
- A configuration change conflicts with an existing order.
- The merchant changes price, capacity, date, or delivery rules while a customer is checking out.

## 11.6 Acceptance Criteria

- Unauthenticated users cannot access the merchant portal.
- Customers cannot access merchant data or controls.
- Configuration changes do not rewrite historical orders.
- Critical administrative actions are traceable.

## 11.7 Dependencies and Open Decisions

- Depends on the merchant staffing model and role boundaries.
- Administrator ownership, account recovery, separation of duties, audit retention, and whether delivery personnel require separate accounts remain open.

# 12. Notifications and Communications

## 12.1 Business Objective

Notify customers and the merchant about critical order events without allowing notification failure to erase or reverse a successfully created order.

## 12.2 Notification Trigger Matrix

| ID | Trigger | Recipient | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- | --- |
| BR-NOT-001 | Order created successfully | Customer | Must | Proposed | MVP |
| BR-NOT-002 | New order received | Merchant | Should | Proposed | MVP |
| BR-NOT-003 | Payment confirmed | Customer | Should | Proposed | MVP |
| BR-NOT-004 | Order confirmed or rejected | Customer | Must | Proposed | MVP |
| BR-NOT-005 | Delivery started | Customer | Should | Proposed | MVP |
| BR-NOT-006 | Order cancelled or refunded | Customer | Must | Proposed | MVP |

## 12.3 Channel and Consent Rules

- Candidate channels are email, WhatsApp, and SMS.
- Final selection depends on budget, provider capabilities, contact-data policy, and applicable consent requirements.
- Notification content must not expose unnecessary personal or order data.

## 12.4 Delivery Failure and Retry Behavior

- Notification failure must not delete or reverse a successful order.
- The merchant portal remains the authoritative source of order status.
- Retry, escalation, and channel fallback behavior are `TBC`.

## 12.5 Acceptance Criteria

- A notification is sent only for the correct order and recipient.
- Notification failure is visible to authorized merchant personnel but does not change the order outcome.
- A customer can retrieve the authoritative status through an approved secure method.

## 12.6 Dependencies and Open Decisions

- Depends on DEC-015, consent requirements, and provider selection.
- The primary channel, provider, sender identity, retry behavior, template language, and escalation policy remain open.

# 13. Reporting and Analytics

## 13.1 Business Objective

Give the merchant basic operational and sales visibility through clearly defined, reconcilable metrics.

## 13.2 Requirements

| ID | Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| BR-RPT-001 | The merchant can view the number of orders for a day. | Must | Proposed | MVP |
| BR-RPT-002 | The merchant can view total orders for a selected date range. | Must | Proposed | MVP |
| BR-RPT-003 | The merchant can view order counts by status. | Must | Proposed | MVP |
| BR-RPT-004 | The merchant can view confirmed payment amounts. | Must | Proposed | MVP |
| BR-RPT-005 | The merchant can view refunded amounts separately. | Must | Proposed | MVP |
| BR-RPT-006 | The merchant can identify popular products and variants. | Should | Proposed | MVP |
| BR-RPT-007 | The merchant can view production demand for a selected delivery date. | Must | Proposed | MVP |

## 13.3 Metric Definitions

- **Order Value:** order amount counted under approved order-status rules; included statuses are `TBC`.
- **Confirmed Payment Amount:** amount confirmed as received through the approved payment process.
- **Refunded Amount:** amount confirmed as refunded.
- **Net Sales Amount:** Confirmed Payment Amount less confirmed refunds; the final accounting definition requires merchant approval.
- A created order must not automatically be treated as realized revenue.

## 13.4 Filters, Time Windows, and Freshness

- Reporting date type, timezone, range limits, and data-freshness expectations are `TBC`.
- Order Date, Delivery Date, Payment Date, and Refund Date must be distinguished where relevant.

## 13.5 Data Quality and Reconciliation

- Report totals should reconcile to authoritative order, payment, and refund records.
- Attribution rules for delayed payments, refunds, and status changes must be approved.

## 13.6 Acceptance Criteria

- Identical filters applied to unchanged data produce consistent results.
- Order count, payments received, and refunds are not represented as the same metric.
- Production demand is calculated from Delivery Date and approved order statuses.

## 13.7 Dependencies and Open Decisions

- Depends on approved order and payment lifecycles and metric definitions.
- Revenue definition, included statuses, timezone, date basis, owner, export needs, and retention remain open.

# 14. Non-Functional Requirements

## 14.1 Performance and Availability

| ID | Proposed Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| NFR-001 | The platform is available during merchant operating periods; the formal availability target is TBC. | Must | Proposed | MVP |
| NFR-002 | Routine catalog queries target p95 below 500 ms under an agreed load. | Should | Proposed; load TBC | MVP |

## 14.2 Security, Privacy, and Data Isolation

| ID | Proposed Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| NFR-003 | Merchant-portal operations require authentication and authorization. | Must | Proposed | MVP |
| NFR-004 | A customer cannot view another customer's order or personal data. | Must | Proposed | MVP |
| NFR-012 | Personal-data collection, use, access, retention, and deletion follow approved policy and applicable legal review. | Must | Pending Approval | MVP |

## 14.3 Reliability, Recovery, and Observability

| ID | Proposed Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| NFR-005 | Accepted order commitments remain consistent with recorded capacity. | Must | Proposed | MVP |
| NFR-006 | Repeated equivalent requests do not create duplicate orders. | Must | Proposed | MVP |
| NFR-007 | Critical business changes can be delivered and verified without losing historical records. | Should | Proposed | MVP |
| NFR-008 | Critical order, payment, and notification failures are traceable by authorized personnel. | Must | Proposed | MVP |
| NFR-009 | Business data is backed up on an approved schedule, and recovery is verified before launch. | Must | Proposed; schedule TBC | MVP |

## 14.4 Usability, Accessibility, and Compliance

| ID | Proposed Requirement | Priority | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| NFR-010 | Customer ordering is mobile-first and supports approved mobile browsers. | Must | Proposed; browser scope TBC | MVP |
| NFR-011 | Critical actions support keyboard use, clear labels, and understandable validation messages. | Should | Proposed | MVP |

Before commercial launch in Malaysia, applicable personal-data, consumer-protection, e-commerce disclosure, tax, and payment-service obligations should be assessed for the final merchant entity and operating model. This BRD does not constitute a legal conclusion.

# 15. Business Rules Register

## 15.1 Rule Definitions

| Rule ID | Business Rule | Decision Status |
| --- | --- | --- |
| RULE-001 | All products use a pre-order model. | Confirmed |
| RULE-002 | All orders in the initial scope require delivery; self-pickup is not supported. | Confirmed |
| RULE-003 | The delivery date must satisfy approved product preparation rules. | Proposed |
| RULE-004 | Closed dates cannot accept new orders. | Proposed |
| RULE-005 | Accepted orders cannot exceed approved production capacity. | Proposed; model TBC |
| RULE-006 | The platform calculates the final amount from approved product, option, delivery, and fee rules. | Proposed |
| RULE-007 | A product price change does not alter historical order amounts. | Proposed |
| RULE-008 | An unavailable product cannot accept a new order. | Proposed |
| RULE-009 | Repeated equivalent checkout submissions must not create duplicate orders. | Proposed |
| RULE-010 | Order cancellation follows the approved cancellation window and policy. | TBC |
| RULE-011 | Modification of an accepted order revalidates all affected rules. | Proposed; modification policy TBC |
| RULE-012 | A delivery address must satisfy the approved service-area rule or an approved manual-quotation exception. | TBC |
| RULE-013 | A refund cannot exceed the refundable amount. | Proposed; policy TBC |
| RULE-014 | Completed, cancelled, rejected, and refunded orders retain necessary transaction history. | Proposed; retention TBC |

## 15.2 Exceptions and Precedence

- Confirmed business rules take precedence over proposed implementation suggestions.
- A rule conflict is not approved until the Business Owner resolves it.
- A merchant override requires an approved policy, an authorized role, and an audit record.

## 15.3 Requirement and UAT Traceability

| Rule | Related Requirements | Related UAT |
| --- | --- | --- |
| RULE-001, RULE-003, RULE-004 | BR-PRE-001–007 | UAT-003 |
| RULE-005 | BR-CAP-001–006 | UAT-005, UAT-006 |
| RULE-006, RULE-007 | BR-CAT-003, BR-CART-006, BR-CHK-004, BR-CHK-008 | UAT-002, UAT-007 |
| RULE-008 | BR-CAT-004, BR-CAT-005, BR-CAT-010 | UAT-001 |
| RULE-009 | BR-CHK-006, BR-ORD-001 | UAT-008 |
| RULE-010, RULE-013 | BR-ORD-010, BR-PAY-007 | UAT-013 |
| RULE-012 | BR-DEL-005, BR-DEL-006 | UAT-004 |
| RULE-014 | BR-ORD-009, BR-PAY-002, BR-PAY-007 | UAT-009–013 |

# 16. Data Requirements

## 16.1 Business Entities and Purpose

| Business Entity | Business Purpose | Decision Status |
| --- | --- | --- |
| Product | Dessert information and availability | Proposed |
| Product Variant | Size, variant, and price | Proposed |
| Product Option | Flavor, add-on, and customization choice | TBC |
| Product Image | Product presentation | Proposed |
| Delivery Zone | Service area and fee policy | TBC |
| Delivery Slot | Available delivery time | TBC |
| Production Capacity | Approved production limit | TBC |
| Capacity Reservation | Committed or temporarily held capacity | TBC |
| Cart | Temporary customer selections | Proposed |
| Order | Order identity, status, and commercial summary | Proposed |
| Order Item | Product, price, and customization snapshot | Proposed |
| Customer Contact | Order contact person | Proposed |
| Delivery Address | Order delivery-address snapshot | Proposed |
| Payment | Amount due and payment-confirmation record | Proposed |
| Refund | Refund request and outcome | Proposed |
| Order Status History | Order-status history | Proposed |
| Admin User | Authorized merchant identity | Proposed |
| Audit Log | Record of critical administrative actions | Proposed |

## 16.2 Historical Snapshots and Audit Records

- An Order Item preserves the accepted product, variant, price, and customization at checkout.
- Delivery Address and Delivery Slot preserve the delivery details used by the accepted order.
- Payment, Refund, Order Status, and critical administrative changes retain necessary history.

## 16.3 Access, Retention, Deletion, and Ownership

- Customer Contact and Delivery Address are personal data.
- Only authorized roles with a fulfilment or support need can access them.
- Retention, deletion, anonymization, customer-rights handling, and data ownership are `TBC`.
- The physical database schema is outside this BRD.

# 17. Interface and Integration Requirements

## 17.1 Integration Inventory

| ID | Business Purpose | Business-Level Data Exchange | Decision Status | Delivery Status |
| --- | --- | --- | --- | --- |
| INT-001 | Collect or confirm payment | Order Reference, Expected Amount, Payment/Refund Result | TBC | MVP |
| INT-002 | Notify customers and merchant | Recipient Contact, approved content, Order Event | TBC | MVP |
| INT-003 | Validate address or zone when external capability is used | Address/Zone Input and Eligibility Result | TBC | MVP or Later |
| INT-004 | Coordinate third-party delivery | Authorized delivery details and Delivery Status | TBC | Later |

## 17.2 Timing, Failure, and Fallback Behavior

- Payment or notification provider failure must not delete an accepted order.
- Delayed or duplicate callbacks must not produce duplicate orders, payments, refunds, or notification outcomes.
- Manual fallback, retry, reconciliation, and customer communication for each provider are `TBC`.

## 17.3 Ownership and Approval Status

- Provider, merchant account, fees, support responsibility, and privacy review are `TBC`.
- API contracts, payloads, authentication, and protocols belong in SA/SRS after provider approval.

# 18. Assumptions and Constraints

## 18.1 Assumptions

| ID | Assumption | Validation Owner |
| --- | --- | --- |
| ASM-001 | The initial business operates in Malaysia. | Business Owner |
| ASM-002 | The initial transaction currency is MYR. | Business Owner |
| ASM-003 | One merchant operates the MVP. | Business Owner |
| ASM-004 | One administrator may perform multiple operational roles. | Merchant staffing and control review |
| ASM-005 | A web storefront is sufficient for the MVP. | Customer and merchant validation |
| ASM-006 | Development capacity is approximately 3–5 hours per week. | Developer |

## 18.2 Confirmed Business Constraints

- Pre-order only.
- Delivery only.
- Self-pickup is not supported in the initial scope.

## 18.3 Proposed Operational Constraints

- The MVP excludes a marketplace, native app, multiple warehouses, advanced loyalty, automated routing, and full cost accounting.
- Capacity, payment, delivery, and notification depend on approved merchant policies and providers.

## 18.4 Legal, Compliance, and Vendor Constraints

- Privacy, consumer, e-commerce, tax, and payment obligations should be reviewed for the final entity and operating model.
- Provider onboarding, fees, service restrictions, and terms may affect scope and launch timing.
- This BRD does not indicate that any provider has been approved.

# 19. Risks and Dependencies

## 19.1 Risk Register

| ID | Risk | Impact | Likelihood | Proposed Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| RISK-001 | Critical merchant policies remain undecided | Rework and delay | TBC | Complete Section 21 decisions before detailed design | Business Owner role |
| RISK-002 | Capacity model is inaccurate | Overbooking and fulfilment failure | TBC | Confirm the capacity unit and test concurrent booking of the last slot | TBC |
| RISK-003 | Payment and order statuses diverge | Financial disputes and operational confusion | TBC | Use separate records, reconciliation, and exception ownership | TBC |
| RISK-004 | Delivery zones are configured incorrectly | Inability to fulfil | TBC | Merchant reviews zones and exception flow before launch | TBC |
| RISK-005 | Customer submits repeatedly | Duplicate production and payment confusion | TBC | Create only one order per equivalent submission and test retries | TBC |
| RISK-006 | Personal data is exposed | Customer harm and compliance impact | TBC | Least-necessary access, protection, audit, and privacy review | TBC |
| RISK-007 | Notification service fails | Customer misses updates | TBC | Keep the portal authoritative and define retries | TBC |
| RISK-008 | Merchant closes unexpectedly | Committed deliveries cannot be fulfilled | TBC | Blackout dates and a customer-resolution policy | Business Owner role |
| RISK-009 | Third-party service is unavailable | Ordering, payment, notification, or delivery is disrupted | TBC | Define fallback and reconciliation for each provider | TBC |

## 19.2 Dependency Register

| Dependency | Required Input or Service | Decision Status |
| --- | --- | --- |
| Merchant Product Information | Products, variants, prices, images, preparation time, and availability | TBC |
| Domain and Hosting | Approved operating environment and ownership | TBC |
| Image Storage | Product-image service and policy | TBC |
| Payment Process / Provider | Approved collection, confirmation, and refund process | TBC |
| Notification Provider | Approved email, WhatsApp, or SMS service | TBC |
| Delivery Operation / Provider | Zones, fees, slots, contacts, and status process | TBC |
| Legal / Privacy Review | Applicable business and personal-data requirements | TBC |

## 19.3 Mitigation Ownership and Escalation

Named owners, decision dates, escalation paths, and risk-review frequency are `TBC`.

# 20. Release Plan, UAT, and Release Gate

## 20.1 Proposed Release Phases

| Phase | Proposed Deliverables | Proposed Duration | Decision Status |
| --- | --- | --- | --- |
| Phase 1 — Catalog and Merchant Foundation | Products, variants, images, and core administrator access | 3–4 weeks | Proposed |
| Phase 2 — Pre-Order and Delivery Rules | Preparation time, zones, slots, and production capacity | 3–4 weeks | Proposed |
| Phase 3 — Checkout and Order Management | Cart, identity model, checkout, order status, and capacity commitment | 4–5 weeks | Proposed |
| Phase 4 — Payment and Merchant Operations | Live payment process, notifications, and basic reporting | 2–3 weeks | Proposed |
| Phase 5 — Testing and Launch Readiness | End-to-end validation, security/privacy, deployment, backup recovery, and merchant acceptance | 2–3 weeks | Proposed |

The 14–19 week estimate assumes approximately 3–5 development hours per week. It is a planning assumption, not a commitment.

## 20.2 UAT Scenarios

| UAT ID | Scenario | Expected Outcome | Related Requirements | Status |
| --- | --- | --- | --- | --- |
| UAT-001 | Browse listed desserts | Available products and current prices are displayed correctly | BR-CAT-003–006, 010 | Proposed |
| UAT-002 | Select a variant and customization | Options and additional amounts are correct | BR-CUS-001–006 | Proposed |
| UAT-003 | Select a delivery date that is too early | Date is rejected with a clear message | BR-PRE-001–007 | Proposed |
| UAT-004 | Enter an undeliverable address | Address is rejected or enters an approved manual-quotation flow | BR-DEL-005–007 | TBC |
| UAT-005 | Exceed production capacity | Order acceptance is prevented | BR-CAP-001–003 | Proposed |
| UAT-006 | Multiple customers reserve the last capacity concurrently | Accepted orders do not exceed capacity | BR-CAP-002–003 | Proposed |
| UAT-007 | Create a valid order | One complete order and unique order number are created | BR-CHK-002–008, BR-ORD-001 | Proposed |
| UAT-008 | Submit the same order repeatedly | No duplicate order is created | BR-CHK-006, BR-ORD-001 | Proposed |
| UAT-009 | Confirm payment | Payment status is correct and traceable | BR-PAY-001–006 | TBC |
| UAT-010 | Merchant confirms and starts production | Authorized statuses update correctly | BR-ORD-005–006 | Proposed |
| UAT-011 | Start delivery | Customer can securely view the new status | BR-ORD-007–008, BR-NOT-005 | Proposed |
| UAT-012 | Complete delivery | Order enters the approved completed state | BR-ORD-007–009 | Proposed |
| UAT-013 | Cancel an order | Capacity, payment, refund, history, and notification follow policy | BR-CAP-004, BR-ORD-010, BR-PAY-007, BR-NOT-006 | TBC |
| UAT-014 | Attempt unauthorized portal access | Access is denied and critical events are traceable | BR-ADM-001, NFR-003 | Proposed |
| UAT-015 | View a sales report | Report reconciles to order, payment, and refund records | BR-RPT-001–007 | Proposed |

## 20.3 Operational Readiness Checklist

- Product and pricing information is approved.
- Pre-order, capacity, delivery, cancellation, modification, payment, and refund policies are approved.
- The commercial payment process is validated.
- Administrator access and recovery are validated.
- Personal-data notice, access, retention, and support processes are reviewed.
- Backup and restore are verified.
- Critical failure and reconciliation procedures are documented.
- An authorized merchant representative completes critical UAT.

## 20.4 MVP Release Acceptance Gate

Commercial launch requires:

- All approved Must requirements are complete and verified.
- All critical UAT scenarios pass under approved policies.
- Payment, administrator access, backup/restore, privacy notice, and security issues meet approved criteria.
- Section 21 records Business Owner approval.

This draft still has unresolved critical policies and approvals and therefore does not yet satisfy the release gate.

# 21. Open Business Decisions, Approval, and Change Control

## 21.1 Open Decision Register

| ID | Decision Required | Options or Suggested Starting Point | Owner | Status |
| --- | --- | --- | --- | --- |
| DEC-001 | Minimum advance notice | 1 / 2 / 3 days or by product; suggested start: 2 days | Business Owner | Open |
| DEC-002 | Daily cut-off time | None / fixed / configurable; suggested: configurable | Business Owner | Open |
| DEC-003 | Product variants and flavors | Fixed / configurable variants and flavors | Business Owner | Open |
| DEC-004 | Message on dessert | Unsupported / enabled by product with a limit | Business Owner | Open |
| DEC-005 | Production-capacity unit | Order count / dessert count / product quota / production hours | Business Owner | Open |
| DEC-006 | Delivery coverage | Zone / postcode / distance / manual quotation | Business Owner | Open |
| DEC-007 | Delivery fee | Flat / zone / distance / manual; suggested: zone-based | Business Owner | Open |
| DEC-008 | Delivery slots | None / fixed / configurable | Business Owner | Open |
| DEC-009 | Payment method | Bank transfer / DuitNow / gateway / both | Business Owner | Open |
| DEC-010 | Payment and merchant-confirmation order | Pay first / confirm first / conditional deposit | Business Owner | Open |
| DEC-011 | Full payment or deposit | Full / deposit / by product; suggested: full | Business Owner | Open |
| DEC-012 | Cancellation window | Time-based / production-state-based / no customer cancellation | Business Owner | Open |
| DEC-013 | Refund eligibility | Merchant policy required | Business Owner | Open |
| DEC-014 | Customer identity | Guest / registration required / both; suggested: guest | Business Owner | Open |
| DEC-015 | Notification channel | Email / WhatsApp / SMS / combination | Business Owner | Open |
| DEC-016 | Delivery addresses per order | One / multiple; suggested: one | Business Owner | Open |
| DEC-017 | Delivery operator | Merchant / third party / hybrid | Business Owner | Open |
| DEC-018 | Modification after submission | Not allowed / allowed before a defined production state | Business Owner | Open |

## 21.2 Priority Merchant Confirmation

The first five decisions for merchant confirmation are:

1. Minimum advance notice and cut-off time.
2. Production-capacity unit and commitment point.
3. Delivery area and fee model.
4. Payment method and payment/merchant-confirmation order.
5. Guest checkout or registered account.

These decisions directly affect checkout, capacity, order lifecycle, payment, customer access, UAT, and release planning.

## 21.3 Approval and Sign-Off

| Approval Area | Approver | Status | Approval Date |
| --- | --- | --- | --- |
| Business Objectives and Scope | Business Owner | Pending | — |
| Product and Customization Rules | Business Owner | Pending | — |
| Pre-Order and Capacity Rules | Business Owner | Pending | — |
| Delivery Policy | Business Owner | Pending | — |
| Payment, Cancellation, and Refund Policy | Business Owner | Pending | — |
| Customer Identity and Notification Policy | Business Owner | Pending | — |
| MVP Release Scope and Gate | Business Owner + Developer | Pending | — |

## 21.4 Change-Control Rules

After formal approval, each material change must record:

- the change and business reason;
- affected requirements, rules, decisions, UAT scenarios, and release phases;
- impact on operations, customer experience, privacy, payment, capacity, delivery, cost, and schedule;
- proposed priority and decision owner; and
- approval result and effective version.

An unapproved change does not automatically become an MVP commitment.

## 21.5 Next Approval Action

The merchant should review DEC-001 through DEC-018 and prioritize the five decisions in Section 21.2. After the affected business policies are approved, the work can proceed to the product backlog, SA/SRS, API contracts, and physical database design.

# Appendix A. Traceability Summary

| Business Objective | Main Requirements | Business Rules | UAT | Approval Area |
| --- | --- | --- | --- | --- |
| BO-001 Online Pre-Order | BR-CAT, BR-CUS, BR-CART, BR-CHK | RULE-001, 003, 006, 008 | UAT-001–004, 007 | Product, Scope, Delivery |
| BO-003 Reduce Missed/Duplicate Orders | BR-CHK-006–008, BR-ORD-001, 009 | RULE-009, 014 | UAT-007–008 | Scope, Order Policy |
| BO-004 Prevent Overbooking | BR-PRE, BR-CAP | RULE-003–005 | UAT-003, 005–006 | Capacity Rules |
| BO-005 Improve Processing | BR-ORD, BR-ADM, BR-NOT | RULE-011, 014 | UAT-010–014 | Operations and Identity |
| BO-006 Sales Visibility | BR-RPT, BR-PAY | RULE-006, 013–014 | UAT-009, 015 | Payment and Reporting |
| BO-007 Customer Visibility | BR-ORD-008, BR-DEL-009, BR-NOT | RULE-002, 014 | UAT-011–013 | Delivery and Notification |

# Appendix B. BRD Quality Gate Summary

| Dimension | Result | Evidence or Remaining Gap |
| --- | --- | --- |
| Format Completeness | Pass | Document control, background, objectives, roles, scope, requirements, rules, data, integrations, assumptions, risks, release, UAT, decisions, and approval are covered. |
| Requirement Quality | Pass with gaps | Stable IDs, standard statuses, module rules, exceptions, and acceptance criteria are present; specific merchant policies remain undecided. |
| Decision Readiness | Needs decision | DEC-001–018 are centrally managed, but no decisions or named approvers are recorded yet. |
| Delivery Readiness | Needs decision | Release and UAT remain Proposed; payment, capacity, delivery, privacy, recovery, and merchant approval are incomplete. |
| BRD/SA Boundary | Pass | Business constraints are retained; endpoints, physical schema, frameworks, and detailed implementation design are excluded. |

**Overall Status:** Ready for merchant decision review, but not approved and not suitable as the final development baseline.
