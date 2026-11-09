## ADDED Requirements

### Requirement: DTS-SVC-01 Event service and equipment history

SweetCommerce SHALL let the merchant record actual setup, event end, teardown, equipment-out and post-teardown inspection on the eligible event. The customer SHALL see confirmed arrangements and progress in owned event activity. Equipment inspection SHALL use the event's equipment identities and reconcile returned plus lost to taken, with damaged a subset of returned. Merchant reads SHALL preserve the previously recorded quantities and audit history.

*Trace: BR-EVT-005/007, BR-ORD-009, BRD §§9, 11 → PRD-17, FN-EVT-08 → SA-F06, SA-S02 → UAT-019.*

#### Scenario: DTS-SVC-01a Proceeding through service and inspection
- **WHEN** the original balance has been verified and the merchant records setup, actual end, teardown, equipment-out and a valid inspection in their eligible phases
- **THEN** the system retains actual and planned timestamps separately, presents confirmed arrangements to the owner and shows the merchant the prior saved quantities on reload
- **AND** completion without extras is available after the required checks

#### Scenario: DTS-SVC-01b Invalid quantities and transitions
- **WHEN** a command uses foreign or duplicate equipment identities, negative quantities, an inconsistent return total, damaged greater than returned, a stale event revision or an invalid service transition
- **THEN** the command is rejected with actionable feedback and existing service and equipment history is preserved

### Requirement: DTS-SVC-02 Separate post-event invoice

SweetCommerce SHALL let the merchant itemize waiting or staffing, equipment damage or loss and applicable extras under the disclosed terms, with item, reason and amount. The invoice SHALL remain separate from the original balance and be payable only by DuitNow, due 48 hours after recorded actual event end. The customer SHALL see invoice details and open, review or paid status. Completion on the additional-bill path SHALL require independently verified eligible extra settlement.

*Trace: BR-EVT-005–007, BR-PAY-012, RULE-016 → PRD-17, FN-EVT-09 → SA-F06, SA-S02 → UAT-019.*

#### Scenario: DTS-SVC-02a Issue itemized extras from actual end
- **WHEN** a merchant records actual end later than scheduled and issues eligible itemized waiting, staffing or equipment charges
- **THEN** the owner sees a separate invoice for the exact item total with due time 48 hours after actual end, and the original balance and original terms remain intact

#### Scenario: DTS-SVC-02b Duplicate or invalid billing
- **WHEN** the merchant retries the same issue command or submits stale, missing or invalid invoice details
- **THEN** the same committed intent returns its invoice without duplication, while invalid new attempts have no charge or ledger effect

#### Scenario: DTS-SVC-02c Verify separate extra payment
- **WHEN** extra payment proof is registered and the merchant independently confirms the exact funds on the extra charge
- **THEN** the extra shows review before confirmation and paid after confirmation, records its receipt once in the extra category and supports event completion
- **AND** failed, mismatched or duplicate evidence cannot mark the invoice paid or change the original balance
