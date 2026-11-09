## ADDED Requirements

### Requirement: DTS-NOT-01 Commercial milestone notices

SweetCommerce SHALL originate the remaining v1 business notices from committed standard and event milestones and merchant work. It SHALL send at most one intent per eligible milestone, source revision or movement and recipient. An existing first-increment top-up intent SHALL retain its source, customer-visible status and original deadline if dispatched through the shared delivery boundary.

*Trace: BR-NOT-001–006, BRD §12, DEC-015/025/028, INT-002 → PRD-18, FN-NOT-01–03 → SA-F07 → UAT-020.*

#### Scenario: DTS-NOT-01a Standard milestone coverage
- **WHEN** a standard order is submitted, enters waiting for payment, records verified or rejected payment, records Cash acceptance or rejection, starts prep, becomes ready for pickup, is handed to Lalamove, completes, cancels, posts a refund or expires
- **THEN** the eligible owner gets the corresponding business notice from the committed fact
- **AND** a repeated event, failed transaction or retry cannot create a duplicate notice intent or reset a top-up deadline

#### Scenario: DTS-NOT-01b Event milestone coverage
- **WHEN** an event request is received, a quote is issued or approaches current expiry, a deposit is verified, a deposit or balance supplement is requested before cutoff, booking is confirmed, the effective balance is due or overdue, arrangements including teardown are confirmed, the event completes, damage/loss is recorded, waiting/staffing or other extras are invoiced, or extra payment is verified
- **THEN** the system originates the corresponding owner notice using the current fact or deadline revision and keeps deposit confirmation distinct from booking confirmation
- **AND** a supplement notice shows the verified difference and existing cutoff, and obsolete supplement work is skipped if the amount, deadline or eligibility changes before dispatch

#### Scenario: DTS-NOT-01c Merchant work and obsolete reminders
- **WHEN** a new application/order, material work needing action or persistent delivery failure is recorded
- **THEN** the system originates eligible merchant intake and action notices and raises an alert with visible follow-up for persistent failure
- **AND** superseded, cancelled, settled or no-longer-applicable quote/balance reminder work is suppressed after rechecking the current revision and state, including timely balance proof review

### Requirement: DTS-NOT-02 Safe delivery and merchant follow-up

SweetCommerce SHALL use WhatsApp as the primary business channel and SMS or email only as an approved eligible fallback. It SHALL keep send attempts and outcomes separate from business state, allow an initial send and at most three safe retries, and expose terminal or unknown delivery for audited merchant follow-up. An ambiguous send SHALL require reconciliation or safe provider deduplication before resend or channel switch.

*Trace: BR-NOT-001–006, NFR-008, INT-002 → PRD-18, FN-NOT-03 → SA-F07, SA-F08 → UAT-020.*

#### Scenario: DTS-NOT-02a Transient outage and retry budget
- **WHEN** delivery fails transiently with a safe retry path
- **THEN** attempts are recorded with safe channel/outcome information and automatic retries stop on success or after three retries
- **AND** any fallback uses only a configured eligible contact and omits private evidence, addresses and bank identifiers

#### Scenario: DTS-NOT-02b Unknown send and expired lease
- **WHEN** the provider outcome is ambiguous or a worker loses its lease after a send
- **THEN** stale workers cannot finalize the new lease, and automatic redelivery or fallback occurs only with safe dedupe or reconciliation
- **AND** an unsafe-to-retry outcome is visible for merchant follow-up

#### Scenario: DTS-NOT-02c Audited resolution
- **WHEN** the merchant views a failed or unknown notice and records manual contact or verified provider reconciliation with a reason
- **THEN** history and terminal follow-up are visible and replay-safe, the resolution itself sends no new message, and the order, event and settlement states remain authoritative and unchanged
