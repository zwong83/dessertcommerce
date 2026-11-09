## ADDED Requirements

### Requirement: DTS-RPT-01 Merchant event work and audit

SweetCommerce SHALL extend the dedicated merchant's work view with typed event, proof, settlement exception and notice targets and bounded filtering. It SHALL record actor, time, action, applicable change and safe reason for key quote, resource, service, payment, refund and notice decisions. Event customer reads SHALL expose only the customer's own safe status and arrangements.

*Trace: BR-ADM-001–010, BR-ORD-001–009, NFR-003/007/008 → PRD-19, FN-ADM-03 → SA-F08 → UAT-014/017–020.*

#### Scenario: DTS-RPT-01a Correct merchant work target
- **WHEN** the enrolled administrator filters work by applicable kind, status or service date and follows a result
- **THEN** the system shows the correct authorized domain target and next action using bounded pages, with event and standard work distinguishable
- **AND** invalid filters or incompatible cursors are refused safely

#### Scenario: DTS-RPT-01b Denial and replay-safe audit
- **WHEN** an unauthenticated or customer principal requests merchant work or an administrator replays a committed event action
- **THEN** unauthorized access reveals no private work or proof, and replay produces no duplicate business audit
- **AND** allowed history contains no raw proof, OTP, private contact or provider payload

### Requirement: DTS-RPT-02 Commercial activity and cash movement report

SweetCommerce SHALL report standard accepted counts and counts by status, confirmed event counts, preparation demand by fulfilment day, and actual verified receipts, posted refunds and net receipts, using Asia/Kuala_Lumpur and MYR. It SHALL keep standard receipts including standard adjustments, event deposits, original balances and event extras as distinct money categories. Net receipts SHALL equal verified receipts less posted refunds.

*Trace: BR-RPT-001–005/007, BO-006, BRD §13 → PRD-20, FN-ADM-04 → SA-F08 → UAT-015.*

#### Scenario: DTS-RPT-02a MYT cutover and independent dates
- **WHEN** the merchant reports across local midnight for records with different acceptance, booking, fulfilment, actual cash movement and recording times
- **THEN** inclusive local dates correspond to the half-open instant range ending at the next local midnight
- **AND** standard acceptance uses accepted time, event count uses first verified booking, demand uses service date and receipts and refunds use their respective actual movement dates

#### Scenario: DTS-RPT-02b Ledger categories and status filter
- **WHEN** the selected range includes Cash, standard DuitNow or adjustments, each event charge category, pending proof, uncertain payout and a later verified refund
- **THEN** posted movements reconcile by category, pending proof and unposted payouts contribute nothing, and a refund-only period can show negative net
- **AND** a standard status filter affects only standard order counts and prep demand, leaving money totals and event counts intact

#### Scenario: DTS-RPT-02c Bounded and empty reports
- **WHEN** the merchant requests a valid range of up to 92 inclusive dates with no records, or an inverted, invalid or over-limit range
- **THEN** the valid range shows an empty or zero state with the date basis, and invalid ranges return actionable validation without running an unbounded query

### Requirement: DTS-RPT-03 Monthly KPI denominators

SweetCommerce SHALL show source counts for website-origin share, on-time standard preparation and event quote conversion for monthly review. The merchant can supply an off-platform accepted count for the same period as a report input. The first complete operating month SHALL establish the baseline, with targets set after observation.

*Trace: BO-002/004/005, BRD §2, BR-RPT-007 → PRD §4, PRD-20, FN-ADM-05 → SA-F08 → UAT-015.*

#### Scenario: DTS-RPT-03a Website share and on-time preparation
- **WHEN** the merchant supplies the period's off-platform count and inspects preparation performance
- **THEN** website share uses website accepted orders and bookings divided by website plus off-platform accepted counts
- **AND** on-time preparation uses actual ready time at or before the promised handoff over orders due for prep with a promise, without treating driver arrival as readiness or altering business records

#### Scenario: DTS-RPT-03b Quote cohort and missing denominators
- **WHEN** one application receives multiple quotes in the period and its deposit is independently verified later
- **THEN** the application counts once in the original quote cohort and contributes to conversion once after verification
- **AND** absent or zero denominators show source counts without a percentage
