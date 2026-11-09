## ADDED Requirements

### Requirement: PAY-01 Start and adjudicate the DuitNow proof window
A standard DuitNow charge SHALL receive a 30-minute proof window only after final amount agreement and production hold. A successfully validated registration strictly before the deadline SHALL retain the hold through review. A deadline without timely proof SHALL expire the order and release unused units. The merchant SHALL verify actual funds independently before acceptance.

Source: PRD-10, FN-PAY-01–02; UAT-006, UAT-008–009, UAT-014. Tasks 4.1, 4.5, 5.1–5.2.

#### Scenario: Timely complete proof
- **WHEN** an owned valid proof is registered before expiry and the expiry worker runs later
- **THEN** the proof remains in review and the hold stays allocated pending merchant review

#### Scenario: No timely proof
- **WHEN** the deadline passes without an eligible registered proof
- **THEN** the system expires the order and releases unused capacity once

#### Scenario: Late proof on an owned closed charge
- **WHEN** the customer uploads evidence after expiry or cancellation
- **THEN** it is recorded only for merchant reconciliation and does not reopen the order or restore the hold

#### Scenario: Foreign invalid or oversized proof
- **WHEN** a caller submits proof for another account or content outside the accepted constraints
- **THEN** the request is rejected without changing the charge or allocation

### Requirement: PAY-02 Reconcile verified receipts and supplements
The system SHALL record independently verified funds once. It SHALL distinguish evidence rejection, top-up requests and terminal order rejection. For a verified shortfall on an active hold, the merchant's top-up notice SHALL state the outstanding amount and give 30 minutes from issuance to register proof. Timely proof SHALL keep the hold through merchant review. With no timely proof, unused capacity SHALL be released when the window expires. The system SHALL accept only an eligible and feasible order with an exact net verified total; after cutoff it SHALL require timely proof for that window even if expiry work is delayed. Late, excess or otherwise unfulfillable funds SHALL enter reconciliation.

Source: PRD-10, PRD-12, FN-PAY-03, DEC-025; UAT-008–009, UAT-013, UAT-020 (top-up only). Tasks 4.2, 4.5–4.6, 5.1–5.2.

#### Scenario: Matched transfer
- **WHEN** the merchant independently verifies the expected transfer for an eligible order
- **THEN** the system records one receipt and accepts the order with the appropriate allocation

#### Scenario: Underpayment followed by a verified supplement
- **WHEN** the merchant posts distinct verified movements against an active mismatch case
- **THEN** partial totals stay under review and the exact agreed total accepts once only if the commitment remains feasible

#### Scenario: Duplicate or excess transfer
- **WHEN** the same movement is posted again or total verified receipts exceed the agreed amount
- **THEN** the ledger does not duplicate the movement, and excess funds do not cause an automatic acceptance

#### Scenario: Top-up proof just before the deadline
- **WHEN** the customer registers valid top-up proof before the 30-minute deadline and merchant review extends beyond it
- **THEN** the capacity remains held until adjudication and the owned order shows proof in review

#### Scenario: Top-up late or missing and expiry worker delayed
- **WHEN** the deadline arrives without qualifying proof and proof or funds arrive at or after the cutoff
- **THEN** unused capacity is released once and late funds are reconciled without acceptance even if the expiry worker is delayed

#### Scenario: Duplicate top-up notice and failed evidence
- **WHEN** the merchant replays a top-up request, the notice is retried, or a file is rejected while the shortfall is unresolved
- **THEN** replay and delivery retry preserve the original deadline, and evidence rejection does not by itself reject the order or prove no funds were sent

#### Scenario: Top-up notice delivery failure
- **WHEN** external delivery of the issued top-up notice is delayed, fails or has an unknown outcome
- **THEN** the owner can still see the request and authoritative deadline in the order, the merchant can follow up, and delivery outcome does not change the order, charge or hold

#### Scenario: Timely top-up review ends without settlement after cutoff
- **WHEN** a timely proof kept the hold through cutoff but review ends without settlement and there is no other timely proof still pending
- **THEN** unused capacity is released once and any actual funds remain in the merchant reconciliation path

### Requirement: PAY-03 Cash collection only at pickup
Cash SHALL be offered only for pickup. Merchant acceptance SHALL recheck capacity and secure it before production. Cash receipt and actual pickup SHALL be recorded together; missed collection SHALL be recorded as no-show without a receipt.

Source: PRD-11, FN-PAY-04; UAT-010. Tasks 4.3, 5.1–5.2.

#### Scenario: Cash pickup
- **WHEN** the merchant accepts an eligible Cash pickup order, then collects payment at pickup
- **THEN** acceptance allocates once and collection records one receipt and completed handoff

#### Scenario: Cash on delivery or no-show
- **WHEN** a customer requests Cash with Lalamove or a confirmed Cash pickup expires uncollected
- **THEN** the request is refused for Lalamove, or the merchant records no-show without posting a receipt

### Requirement: PAY-04 Guard cancellation and refund disposition
The system SHALL allow a customer to cancel only before transfer and acceptance, with confirmation of no transfer and no recorded or disputed evidence to the contrary. For sent or uncertain transfers it SHALL block customer cancellation and provide the external merchant WhatsApp contact. The merchant SHALL handle authorized exceptions and record full remaining refund obligations per verified receipt when unable to fulfil. A manual refund SHALL reserve refundable funds first, and confirmed payout SHALL post once. An uncertain payout SHALL stay reserved until resolved.

Source: PRD-12, FN-PAY-05–06, DEC-022; UAT-008, UAT-013. Tasks 4.3–4.4, 5.1–5.3.

#### Scenario: Eligible customer cancellation
- **WHEN** the owner confirms no transfer, the order has not been accepted and there is no payment evidence or unresolved transfer case
- **THEN** the system records cancellation and releases unused capacity without posting a refund

#### Scenario: Sent or uncertain transfer before proof upload
- **WHEN** the customer indicates money was or may have been sent, or settlement already shows conflicting evidence
- **THEN** the customer cannot cancel, the order and allocation stay as they were and the customer sees the external WhatsApp contact for follow-up

#### Scenario: Concurrent or duplicate refund
- **WHEN** two refund attempts target the same remaining verified receipt amount
- **THEN** only amounts within the refundable remainder can be reserved or posted, and a payout is recorded once

#### Scenario: Uncertain payout then confirmed non-payout
- **WHEN** a merchant marks the refund uncertain and subsequently verifies no payout occurred
- **THEN** the same intent is resolved without duplicate payment and its reservation is released only after non-payout confirmation

#### Scenario: Merchant cannot fulfil
- **WHEN** the merchant cancels a paid order it cannot fulfil
- **THEN** the process records one full remaining refund obligation per verified receipt, preserves audit and used capacity, and never duplicates the actual payout on replay
