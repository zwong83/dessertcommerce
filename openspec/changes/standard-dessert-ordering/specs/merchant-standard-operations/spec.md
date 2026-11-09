## ADDED Requirements

### Requirement: OPS-01 Dedicated merchant access and recovery
The system SHALL support a dedicated, enrolled administrator session and verified recovery. It SHALL reject customer or unauthorized access to merchant actions, work, proof and financial details.

Source: PRD-19, FN-ADM-01–02; UAT-014. Tasks 2.1, 5.2–5.3.

#### Scenario: Authorized merchant
- **WHEN** the enrolled administrator verifies through the designated merchant challenge
- **THEN** the merchant can access the standard-order work surface

#### Scenario: Customer or unenrolled principal
- **WHEN** an ordinary customer or unenrolled contact attempts merchant access
- **THEN** the system denies access without provisioning a merchant account or leaking protected details

#### Scenario: Verified recovery revokes earlier access
- **WHEN** the merchant completes recovery through an enrolled verified phone or email
- **THEN** prior admin sessions and unused pre-recovery challenges cannot establish access

#### Scenario: Loss of all enrolled channels
- **WHEN** neither enrolled channel can be used
- **THEN** the system provides the controlled manual support path and never grants access from a newly supplied contact alone

### Requirement: OPS-02 Bounded standard-order work and audit
The merchant portal SHALL show bounded standard-order work for catalogue, capacity, order, fee, proof, reconciliation, refund and fulfilment actions as applicable. The server SHALL guard every transition and retain authorized audit evidence with actor, action, time and reason, excluding credentials and private proof contents.

Source: PRD-19, FN-ADM-03 (standard); UAT-008–010, UAT-013–014. Tasks 4.4–4.5, 5.2–5.3.

#### Scenario: Merchant opens an unresolved payment item
- **WHEN** a refund is uncertain or a late proof created a reconciliation case
- **THEN** the queue shows a scoped drill-down and the applicable next action

#### Scenario: Guarded replay or unauthorized mutation
- **WHEN** a protected action is repeated or an unauthorized actor attempts it
- **THEN** authorized replay creates no duplicate effect or audit event and the denied action creates no business mutation

#### Scenario: Review of a confirmed change
- **WHEN** the merchant accepts an order, changes a fee or reconciles a receipt
- **THEN** the action, actor, time and safe reason are traceable without exposing credential or proof content

### Requirement: OPS-03 Provide usable role-scoped standard journeys
The standard storefront and merchant portal SHALL provide keyboard-operable, labelled actions with visible focus, mobile-friendly layouts, loading and failure feedback, and next actions for eligible work. They SHALL display monetary amounts in MYR and local business times in MYT. The storefront SHALL use the Gather Dessert visual reference with verified text contrast.

Source: PRD §§7,9, BRD NFR-002 and NFR-010–011; SD Frontend §§2–4. Tasks 5.1–5.3, 6.1.

#### Scenario: Mobile or keyboard journey and recoverable failure
- **WHEN** a customer or merchant navigates their standard flow by keyboard or on a supported narrow viewport and encounters a stale, empty or failed result
- **THEN** they can identify the current state, reach the available next action and recover without losing applicable form input or exposing another account's records
