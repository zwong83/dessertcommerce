## ADDED Requirements

### Requirement: DTS-PAY-01 Deposit quote timing and review

SweetCommerce SHALL use manual DuitNow only for event payments. The quote total SHALL be at least two sen. The deposit SHALL be half rounded up to a whole sen and the balance SHALL be the positive remainder. The quote and deposit window SHALL end at the earlier of issue plus three days and the offered deposit deadline, no later than four days before the event. Qualifying proof registered strictly before cutoff SHALL preserve the tentative window during review. Only independent verification of the exact deposit on an eligible charge confirms a feasible booking. Eligible expiry or explicit deposit rejection SHALL release unused resources once.

*Trace: BR-EVT-004, BR-CAP-004/008, BR-PAY-010, DEC-020/029 → PRD-15, FN-EVT-03/05 → SA-F06, SA-S02 → UAT-017/018.*

#### Scenario: DTS-PAY-01a Both bounds and odd sen
- **WHEN** a merchant issues a quote with an odd-sen total, once with issue plus three days as the binding bound and once with an earlier allowed deposit deadline
- **THEN** the displayed amounts sum to the exact quote total and the earlier deadline governs both consent and deposit
- **AND** an offer with no usable payment window is refused and the merchant can offer another date

#### Scenario: DTS-PAY-01b Timely proof wins over expiry
- **WHEN** valid proof is registered just before cutoff and the expiry worker runs concurrently or while proof remains in review after cutoff
- **THEN** the tentative slot stays reserved, proof shows as pending and only independent merchant verification posts the receipt and confirms an eligible booking

#### Scenario: DTS-PAY-01c Cutoff and late evidence
- **WHEN** proof is absent, invalid, unfinished, or successfully registered exactly at or after cutoff
- **THEN** it confers no timely-review protection, even if expiry work has not yet run, and eligible expiry releases the unused window once
- **AND** valid late evidence is kept for reconciliation without reopening the quote, booking or window

#### Scenario: DTS-PAY-01d Explicit deposit rejection
- **WHEN** the merchant explicitly rejects the deposit under the current eligible state
- **THEN** the system records the reason, releases unused resources once and routes any identified funds through settlement
- **AND** rejecting an evidence file alone records an evidence outcome distinct from terminal rejection or verification

#### Scenario: DTS-PAY-01e Minimum quote and positive instalments
- **WHEN** the merchant submits a zero-sen or one-sen quote, or an otherwise eligible two-sen or three-sen quote
- **THEN** zero and one sen are rejected before any new or replacement quote or window is written
- **AND** two sen splits as 1 + 1 and three sen splits as 2 + 1, with both instalments positive and summing to the quote

### Requirement: DTS-PAY-02 Original and effective balance deadlines

SweetCommerce SHALL show and settle the original event balance separately from deposit and extras. The original balance is due three days before the event, with an overdue reminder and 24 hours of ordinary grace. If timely deposit proof is verified after the original balance deadline, the merchant SHALL record a feasible or infeasible disposition. The feasible path SHALL start one 24-hour window from verification. The infeasible path SHALL record a reschedule or refund case while preserving the verified receipt.

*Trace: BR-PAY-011, DEC-021 → PRD-16, FN-EVT-06/07 → SA-F06, SA-S02 → UAT-018.*

#### Scenario: DTS-PAY-02a Ordinary due, grace and payment
- **WHEN** the deposit is verified by the original balance due instant
- **THEN** the original deadline applies and an unpaid eligible balance has a 24-hour grace period and an overdue reminder
- **AND** independently verified exact balance on an eligible booking advances it to proceeding and suppresses obsolete reminders

#### Scenario: DTS-PAY-02b Feasible verification after the original due instant
- **WHEN** the merchant verifies timely deposit proof after the original due instant, including during the ordinary grace period, and explicitly confirms feasibility with a reason
- **THEN** the receipt is recorded once and the effective due time and cutoff are verification plus 24 hours, with no second grace period
- **AND** the customer sees the effective deadline, stale work is suppressed and replay leaves the replacement deadline unchanged

#### Scenario: DTS-PAY-02c Due instant passes during review
- **WHEN** the original balance due instant passes before the merchant verification commits and the request lacks a late-deposit disposition
- **THEN** the server returns `409 DEPOSIT_DISPOSITION_REQUIRED` without posting or committing the stale action

#### Scenario: DTS-PAY-02d Infeasible late verification
- **WHEN** timely deposit proof is independently verified after the original balance deadline and fulfilment is infeasible
- **THEN** the verified receipt is preserved and a merchant case remains open for a consented reschedule or documented refund
- **AND** the system exposes no new balance collection deadline or confirmed new schedule merely from that receipt

### Requirement: DTS-PAY-03 Balance proof protection and merchant nonpayment cancellation

SweetCommerce SHALL protect the event slot while qualifying original balance proof registered strictly before the effective cutoff remains in review. The cutoff SHALL be the current effective grace end if present or the effective due time otherwise. Only the merchant SHALL cancel for nonpayment after that cutoff, after resolving timely review, checking the bank and attesting with a reason that no balance funds were received, and after the server checks for recorded or unresolved possible funds. The worker SHALL preserve booking state while flagging follow-up.

*Trace: BR-PAY-011, DEC-021/026 → PRD-16, FN-EVT-06/07 → SA-F06, SA-S02 → UAT-018.*

#### Scenario: DTS-PAY-03a Timely review across either cutoff
- **WHEN** valid balance proof arrives during ordinary grace or the replacement window just before its cutoff, and merchant review continues past the cutoff
- **THEN** the slot stays reserved, the customer sees review and stale reminders are suppressed
- **AND** overdue cancellation fails while review remains pending, even in a proof-versus-cancellation race

#### Scenario: DTS-PAY-03b Disputed, late or rejected proof
- **WHEN** proof arrives at or after the cutoff, proof is rejected, or there are recorded partial, mismatched, paid or unresolved possible funds
- **THEN** late evidence enters reconciliation, rejection alone does not establish nonpayment, and recorded or unresolved possible funds block overdue cancellation
- **AND** a paid balance proceeds only once and can never be cancelled as overdue

#### Scenario: DTS-PAY-03c Guarded overdue cancellation
- **WHEN** the current cutoff has passed, review is resolved, no balance funds are recorded or in dispute and the merchant attests to a bank check with a reason
- **THEN** the system records merchant nonpayment cancellation and releases unused resources once
- **AND** a cancellation at or before cutoff, on a stale revision, without attestation or otherwise ineligible leaves resources and business state intact

### Requirement: DTS-PAY-04 Transfer cutoff for customer cancellation

An owner SHALL be able to cancel an eligible application or quote free of charge before the first transfer, including after quote acceptance while awaiting deposit. SweetCommerce SHALL require explicit confirmation of no transfer and check current state, proof, receipts and unresolved evidence. From the first transfer, the customer-requested cancellation path SHALL be unavailable, including through merchant actions. A paid balance SHALL confer no customer-initiated refund regardless of time remaining.

*Trace: BRD §10.2, BR-EVT-004, DEC-023/024 → PRD-14/16, FN-EVT-04/07 → SA-S02 → UAT-017/018.*

#### Scenario: DTS-PAY-04a Free cancellation before first transfer
- **WHEN** an owner confirms no transfer on an eligible application, offered quote or accepted quote awaiting deposit and no conflicting evidence exists
- **THEN** the system records cancellation, releases any unused window once and creates no refund

#### Scenario: DTS-PAY-04b Transfer already sent or balance paid
- **WHEN** a customer indicates transfer was sent or is unsure, or the current record shows proof, paid deposit, paid balance or unresolved transfer evidence
- **THEN** customer cancellation is unavailable, including a merchant `CUSTOMER_REQUEST` action
- **AND** a customer request against a paid balance leaves the booking and refund obligations unchanged even more than three days before the event

#### Scenario: DTS-PAY-04c Cancellation races evidence
- **WHEN** an eligible pre-transfer cancellation and valid proof registration race on the same event
- **THEN** registered proof blocks cancellation if it commits first
- **AND** if cancellation commits first, later evidence is reconciliation-only and cannot reopen the booking or window

### Requirement: DTS-PAY-05 Reschedule and refund disposition

SweetCommerce SHALL preserve original quote, terms, first verified booking time where one exists, and ledger during event recovery. A feasible reschedule SHALL require recorded customer consent, merchant reason, current version and a valid replacement window. Settled balance remains paid. For outstanding balance, the agreed due instant SHALL fall on the new MYT event date minus three calendar days and still be in the future at commit. Grace SHALL end exactly 24 hours later. If the new due time cannot be met, the case SHALL remain open for a different date or refund. The merchant SHALL record force-majeure disposition manually. Merchant inability to fulfil before completion SHALL create full remaining refund obligations for verified receipts, including after balance payment.

*Trace: BRD §§10.2, 16, BR-PAY-007/008, DEC-021/024/026/027 → PRD-16, FN-EVT-07 → SA-F06, SA-S02 → UAT-018.*

#### Scenario: DTS-PAY-05a Agreed replacement schedule
- **WHEN** the merchant records consent, reason, feasible replacement and a valid balance plan under approved policy
- **THEN** the unused windows are swapped atomically and the effective schedule is visible
- **AND** a settled balance stays settled with no new collection deadline, while outstanding balance for an event moved to 20 December is due on 17 December MYT with 24 hours' grace, a new revision and current reminder

#### Scenario: DTS-PAY-05b Failed or unapproved reschedule
- **WHEN** consent is missing, the revision is stale, replacement conflicts, the due date or grace is invalid, or the new due instant is at or before commit time
- **THEN** there is no partial swap or schedule confirmation, existing commitments and financial facts are preserved and the case stays open
- **AND** if the due time cannot still be met, the merchant can agree another date or refund instead
- **AND** after a successful swap, an old reminder or cancellation evaluated against the old cutoff cannot act on the new booking

#### Scenario: DTS-PAY-05c Merchant unable to fulfil
- **WHEN** the merchant records inability to fulfil an eligible event before completion, including after original balance payment
- **THEN** the system records the cancellation basis and one full remaining refund obligation per verified receipt, net of posted payouts, and releases only unused resources
- **AND** a replay or competing payout cannot duplicate obligations or exceed any receipt's refundable remainder

#### Scenario: DTS-PAY-05d Refund uncertainty and case closure
- **WHEN** an eligible payout is reserved and the outcome is uncertain
- **THEN** the amount remains reserved until the same intent is resolved by confirmed non-payout or independently verified payout
- **AND** non-payout releases the reservation, payout posts once and a DEC-021 case closes only after eligible reschedule or reconciled refund disposition

#### Scenario: DTS-PAY-05e Force majeure and no invented disposition
- **WHEN** force majeure requires merchant intervention
- **THEN** the merchant records the reason and agreed disposition under approved policy, and the system preserves financial history and releases only unused resources if valid cancellation commits

### Requirement: DTS-PAY-06 Private proof and independent ledger

SweetCommerce SHALL bind proof to an owned event and exact charge and record successful registration separately from receipt verification. Only the dedicated administrator SHALL review proof content, confirm actual receipts or post refunds. The system SHALL protect evidence bytes, deduplicate uploads and bank movements, and send late, partial, excess, unmatched or uncertain funds to reconciliation without silently confirming a booking or closing a charge.

*Trace: BR-PAY-007/008/010–012, RULE-009/013/016, NFR-003–008 → FN-EVT-05–09, FN-ADM-03 → SA-F06 → UAT-008/014/017–019.*

#### Scenario: DTS-PAY-06a Safe proof registration
- **WHEN** the owner uploads an allowed complete JPEG, PNG or PDF of at most 5 MiB to an eligible charge
- **THEN** the system records private evidence once and exposes only status to the customer
- **AND** spoofed, unscannable, interrupted, empty or oversize uploads cannot protect resources or post funds

#### Scenario: DTS-PAY-06b Role, scope and duplicate movements
- **WHEN** a foreign account submits to the charge, a customer attempts to read proof bytes or execute a merchant command, or a verified reference is replayed or presented for a different charge
- **THEN** foreign owned resources return non-disclosing 404, merchant-only actions are denied to customers, and no duplicate or cross-charge ledger movement posts

#### Scenario: DTS-PAY-06c Confirmed money in reconciliation
- **WHEN** a merchant verifies actual mismatched or late funds against an open case
- **THEN** the system records the independently verified movement once and keeps it visible to reconciliation without restoring expired commitments or treating a shortfall as the full deposit, balance or extra

### Requirement: DTS-PAY-07 Event shortfall uses the existing cutoff

When the merchant verifies a deposit or original balance shortfall before the existing cutoff, SweetCommerce SHALL notify the customer of the exact difference and current cutoff. It SHALL independently verify each transfer against the same charge and record it once. Only the exact net verified total on an eligible charge SHALL advance settlement. A timely supplement SHALL retain review protection even if verified after cutoff. A shortfall unresolved after cutoff SHALL enter manual reconciliation with verified funds preserved and no fresh deadline or automatic confirmation.

*Trace: BR-PAY-007/008/010/011, DEC-020/021/026/028 → PRD-15/16, FN-EVT-05/06 → SA-F06, SD-F06 → UAT-017/018.*

#### Scenario: DTS-PAY-07a Verified shortfall followed by exact timely supplement
- **WHEN** the merchant verifies RM450 of RM500 before cutoff, requests the RM50 difference and the customer registers the second transfer proof before the same cutoff
- **THEN** the due time is unchanged, each verified transfer posts once and the exact total settles the eligible charge even when merchant review finishes after cutoff
- **AND** a fully verified late deposit still follows DEC-021 for balance timing

#### Scenario: DTS-PAY-07b Unresolved at cutoff or late evidence
- **WHEN** the first verified shortfall is discovered at or after cutoff, or the qualifying supplement is missing, late or still insufficient
- **THEN** keep actual funds in manual reconciliation without extending the deadline, confirming settlement or reopening expired resources
- **AND** partial balance funds do not satisfy the no-funds guard for overdue cancellation

#### Scenario: DTS-PAY-07c Duplicate notice, transfer or excess
- **WHEN** the request or a verified movement is replayed, or net verified receipts exceed the charge amount
- **THEN** the same request retains its cutoff, each bank reference posts once and excess funds never settle automatically
