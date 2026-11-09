## ADDED Requirements

### Requirement: CUS-01 Verified customer account access
The system SHALL require verified phone OTP sign-in before exposing customer catalogue, cart, checkout or standard order history. It SHALL derive role and ownership from the verified session.

Source: PRD-01, FN-ACC-01–02; UAT-001, UAT-014, UAT-016. Tasks 2.1, 5.1, 5.3.

#### Scenario: Valid unused code
- **WHEN** a customer submits a valid unused challenge code
- **THEN** the system establishes the customer session and permits access to that account's resources

#### Scenario: Invalid expired or repeated code
- **WHEN** a code is invalid, expired, already consumed or the verification dependency is unavailable
- **THEN** no session is created and the sign-in flow offers a safe retry or recovery

#### Scenario: Foreign customer data
- **WHEN** a customer tries to read or mutate another account's order or cart
- **THEN** the server denies the request without exposing or changing the other account's data

#### Scenario: Logout clears access
- **WHEN** a signed-in customer logs out or an earlier session is revoked
- **THEN** that session cannot read owned resources and the browser clears private views before another identity uses the same device

### Requirement: CUS-02 Persistent versioned account cart
The system SHALL retain unpurchased quantities until removed and expose the same account-owned cart on a different device after sign-in. Cart updates SHALL validate the current cart version and SHALL NOT allocate production.

Source: PRD-02, FN-CART-01–02; UAT-002, UAT-016. Tasks 2.2, 5.1.

#### Scenario: Resume on another device
- **WHEN** the same account signs in on a new browser
- **THEN** the browser loads the authoritative cart, including retained quantities

#### Scenario: Stale cart update
- **WHEN** a device submits an edit against a version replaced by another device
- **THEN** the server rejects the stale edit and the client refreshes the authoritative cart without overwriting it

#### Scenario: Remove an item
- **WHEN** a customer removes the last quantity of an item
- **THEN** the line is removed and no allocation is created or released

#### Scenario: Cart quantity and reference subtotal
- **WHEN** the customer adds or changes a valid sellable variant
- **THEN** the cart shows the updated quantity and reference subtotal without allocating production
- **AND** an invalid quantity or an unavailable variant is rejected with actionable feedback and leaves the previous cart intact

### Requirement: CUS-03 Consume purchased quantities once
At formal standard order acceptance, the system SHALL remove at most the accepted quantities from the surviving matching cart lines in the same transaction. It SHALL preserve unrelated selections and replacements of removed lines.

Source: PRD-03, FN-CART-03; UAT-007, UAT-008. Tasks 2.2, 3.3.

#### Scenario: Successful acceptance or repeated response
- **WHEN** an order becomes accepted and the acceptance command is retried
- **THEN** the purchased quantities are consumed once and unrelated quantities remain

#### Scenario: Removal and re-add while order is pending
- **WHEN** an older order is accepted after the customer removed and re-added its item as a new cart line
- **THEN** the replacement line remains in the cart

#### Scenario: Failed or expired submission
- **WHEN** an order expires or fails before acceptance
- **THEN** its unpurchased cart contents are not removed by that order
