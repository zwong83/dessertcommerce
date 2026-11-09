## ADDED Requirements

### Requirement: DTS-APP-01 Owned and eligible event intake

SweetCommerce SHALL accept an application from a signed-in customer with a local event date, start, expected end, setup ready-by time, venue, positive guest count, budget, occasion, theme, explicit special requirements or none, contact name and phone. Notification email is optional. The server SHALL validate coherent dates/times and a minimum of seven calendar days from the submission day in Asia/Kuala_Lumpur, advancing the submission day after 22:00. Applications SHALL stay separate from standard orders and preserve one application per customer submission intent.

*Trace: BR-EVT-001, BR-PRE-001–007, BO-003, DEC-014/019 → PRD-13, FN-EVT-01/04 → SA-F05 → UAT-003/008/014/017.*

#### Scenario: DTS-APP-01a Seven-day lead boundary
- **WHEN** an otherwise valid request is submitted just before or exactly at 22:00 MYT for the seventh calendar day after today
- **THEN** it is eligible, while the same date just after 22:00 is ineligible and the eighth day is the earliest eligible date

#### Scenario: DTS-APP-01b Correctable form errors
- **WHEN** a customer omits a required field, submits inconsistent dates or times, or chooses a date below the lead-time limit
- **THEN** the system returns field-safe feedback, retains editable inputs and creates no application or window
- **AND** a valid application with explicit no special requirements and no email is accepted

#### Scenario: DTS-APP-01c Durable application replay
- **WHEN** the same customer retries the same intent and payload after a lost response, concurrently or after command-receipt expiry while the application is retained
- **THEN** the system returns the same application and number without a duplicate intake notice
- **AND** a changed payload under that intent conflicts, while another customer's intent is scoped to that customer's account

#### Scenario: DTS-APP-01d Owned event activity
- **WHEN** a verified customer opens their bounded event list or detail on another device
- **THEN** the system shows only their event activity, separately from standard orders, with authoritative state and next action
- **AND** an unauthenticated caller is denied, a foreign ID returns non-disclosing 404, and merchant assessment notes are omitted from customer reads

### Requirement: DTS-APP-02 Manual assessment of shared resources

Before issuing a quote, the merchant SHALL assess kitchen workload, staff, overlapping event and standard commitments, venue and travel between locations, setup, teardown and equipment availability. SweetCommerce SHALL record the assessment and window and make tentative, booked and used windows visible to merchant planning. The merchant SHALL be able to consult and adjust standard availability through the existing capacity controls.

*Trace: BR-EVT-002, BR-CAP-004/005/008, BRD §18 → PRD-14, FN-EVT-02/03 and FN-CAL-01 boundary → SA-F05 → UAT-017.*

#### Scenario: DTS-APP-02a Shared capacity review
- **WHEN** the merchant assesses a request for a day with standard orders and overlapping event windows
- **THEN** the merchant can consult both commitments, record the staffing, resource and time assessment and use the existing standard-capacity workflow if an adjustment is needed
- **AND** recording an event window does not allocate standard product units or cancel existing orders

#### Scenario: DTS-APP-02b Infeasible proposal or decline
- **WHEN** resources or timing are unsuitable, including where the deposit deadline cannot be met
- **THEN** the merchant can propose an alternative schedule or record a decline as applicable
- **AND** the owner sees the proposed date as informational and it creates no reservation or payment obligation

#### Scenario: DTS-APP-02c Concurrent schedule review
- **WHEN** overlapping commitments change during quote issuance or another command supersedes the current event version
- **THEN** issuance consults current windows and the event version before committing
- **AND** an invalid or stale attempt leaves the existing commitments intact and creates no duplicate live quote or window

### Requirement: DTS-APP-03 Quote terms and consent

SweetCommerce SHALL issue a current versioned quote and tentative window together only if the total and instalments meet DTS-PAY-01. The offer SHALL display package, services, total, positive instalments, deadlines, event and setup times, same-day teardown, equipment, known extra-charge rules and pre-transfer cancellation terms. Acceptance SHALL bind the exact current quote ID, version and terms. The accepted offer SHALL show awaiting deposit until proof review and SHALL become a confirmed booking only after eligible verified deposit settlement.

*Trace: BR-EVT-003/004/007, BR-PAY-010, DEC-019/020/023 → PRD-14/15, FN-EVT-03/04 → SA-F05, SA-S02 → UAT-017/018.*

#### Scenario: DTS-APP-03a Accept a fully disclosed current offer
- **WHEN** the owner accepts the current eligible quote and exact terms before expiry
- **THEN** the system records consent, retains the tentative window and presents the deposit instructions and awaiting-deposit state
- **AND** the accepted terms remain readable after subsequent configuration changes

#### Scenario: DTS-APP-03b Superseded, stale or expired consent
- **WHEN** the merchant supersedes an unaccepted offer, terms change, or the owner submits an expired offer or stale event/quote revision
- **THEN** the system rejects stale consent with a refreshable result and does not create a charge or second live reservation
- **AND** a successful revision replaces the prior unaccepted offer and releases its unused window once

#### Scenario: DTS-APP-03c Alternative date becomes effective through the quote
- **WHEN** a proposed alternative is used for a new eligible quote
- **THEN** the customer can distinguish their requested date from the proposal and quoted schedule, and sees a confirmed schedule only when the quote has been accepted and the deposit verified
