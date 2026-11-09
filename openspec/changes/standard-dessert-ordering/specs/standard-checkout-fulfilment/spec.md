## ADDED Requirements

### Requirement: ORD-01 Review and commit one order
Before submission, the system SHALL show selected variants and flavours, the contact name and phone, optional notification email, a pickup point or one delivery address, proposed time, fees, payable or provisional total and applicable terms. Submission SHALL bind the reviewed inputs and use one order per checkout review. The owning customer SHALL be able to read the accepted snapshot and SHALL NOT edit an order after payment.

Source: PRD-07–08, FN-ORD-01–02; UAT-007–008. Tasks 3.1, 5.1.

#### Scenario: Reviewed submission
- **WHEN** a signed-in customer submits the current reviewed checkout
- **THEN** the system records one order number and the authoritative snapshot

#### Scenario: Review changed
- **WHEN** contact, address, selection, price, terms, availability or cart version changed after review
- **THEN** the system requests a fresh review and does not silently accept the changed order

#### Scenario: Unknown submission outcome after reload
- **WHEN** the browser reloads while the submission outcome is uncertain
- **THEN** resolving or abandoning the original review returns its existing order or prevents a later submission of that review before a replacement can start

#### Scenario: Historical order after catalogue or terms change
- **WHEN** the owner opens a paid order after the catalogue or terms change
- **THEN** the captured contact, fulfilment, selected flavour, price and accepted terms text match the committed snapshot
- **AND** the customer cannot edit the paid order

### Requirement: ORD-02 Present and govern the three handoff modes
The system SHALL support self pickup, merchant-arranged Lalamove, and customer-arranged Lalamove. Pickup SHALL use the merchant pickup location. Customer-arranged Lalamove SHALL disclose that the customer pays the external fee separately. Merchant-arranged Lalamove SHALL require serviceability review and explicit consent to the current fee, total, time and terms before any transfer window starts.

Source: PRD-07–09, FN-ORD-03–05; UAT-004, UAT-010–012. Tasks 3.2, 5.1–5.2.

#### Scenario: Merchant-delivery consent
- **WHEN** the merchant records a serviceable offer and the customer accepts the current version with capacity still available
- **THEN** the system commits the fee and terms and starts the transfer window

#### Scenario: Unserviceable or stale offer
- **WHEN** the address is unserviceable or the customer accepts a superseded offer
- **THEN** the system does not collect the outdated fee and shows a denial, current offer or eligible recovery

#### Scenario: Customer-arranged delivery
- **WHEN** the customer chooses to book Lalamove directly
- **THEN** the standard order does not include the externally paid delivery fee and can track merchant handoff

#### Scenario: Serviceable counteroffer before rejection
- **WHEN** the requested merchant-arranged time cannot be served but the merchant proposes a valid different time and fee
- **THEN** the customer sees the revised time, fee and terms and must accept that version before a payment window can start

#### Scenario: Fixed pickup point
- **WHEN** a customer selects an eligible pickup time
- **THEN** checkout shows the fixed pickup location, no delivery fee and the eligible Cash and DuitNow options

### Requirement: ORD-03 Track fulfilment and consented recovery
The system SHALL let a customer list and inspect owned standard orders with a next action and no internal notes. It SHALL preserve promised handoff, actual readiness, driver arrival and actual pickup or handoff as separate facts and allow only guarded merchant transitions. Redelivery, reschedule and any extra delivery charge SHALL require recorded customer agreement to the exact revision or amount.

Source: PRD-09, FN-ORD-06–08; UAT-010–014. Tasks 3.3–3.4, 5.1–5.3.

#### Scenario: Normal fulfilment
- **WHEN** the merchant prepares an accepted order, marks it ready and records an authorized pickup or driver handoff
- **THEN** the customer sees the updated timeline and the actual handoff is retained

#### Scenario: Failed reallocation
- **WHEN** a customer-agreed reschedule cannot secure required new capacity
- **THEN** the previous commitment stays intact and the merchant receives an actionable conflict

#### Scenario: Extra delivery charge
- **WHEN** the merchant tries to record an additional delivery charge without documented customer agreement
- **THEN** the system rejects the charge and preserves the original agreed total

#### Scenario: Successful consented recovery
- **WHEN** the merchant records the agreed revision or additional fee after a delivery incident
- **THEN** the order keeps the agreement and the resulting promise or separate charge is visible without rewriting the original total

#### Scenario: Driver arrival and incident without handoff
- **WHEN** a driver arrives and the merchant records a problem before or after actual handoff
- **THEN** the timeline distinguishes arrival, readiness and any actual handoff, preserves existing facts and exposes an eligible merchant follow-up without disclosing private notes
