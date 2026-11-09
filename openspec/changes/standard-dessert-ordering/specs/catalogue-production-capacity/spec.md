## ADDED Requirements

### Requirement: CAT-01 Manage and show a standard catalogue
The system SHALL allow the dedicated administrator to manage catalogue classification, fixed variants and flavours, prices, image references, lead times, publication state and closure dates. Customer reads SHALL expose eligible selections only and retain historical purchase snapshots.

Source: PRD-04, FN-CAT-01, FN-CAT-03–04; UAT-001–002. Tasks 2.3, 5.1–5.2.

#### Scenario: Classified eligible product
- **WHEN** an administrator lists a sellable product with a category, price and valid variant
- **THEN** a signed-in customer can find it in that category and see its eligible choices

#### Scenario: Archived or suspended product
- **WHEN** a previously purchased product is archived or suspended
- **THEN** it is unavailable for new selection and its historical purchased description and price remain visible

#### Scenario: Draft and publication controls
- **WHEN** the merchant saves a draft or changes a product to unlisted, suspended, sold out or archived
- **THEN** it cannot enter new checkout while ineligible and its already committed order snapshots remain intact
- **AND** restoring an eligible product makes only its currently valid variants, photos and prices available to the storefront

#### Scenario: Invalid catalogue edit
- **WHEN** a product edit fails validation or conflicts with a newer version
- **THEN** the merchant sees the rejected fields or version conflict, retains the draft input and keeps the previous saved product intact

### Requirement: CAT-02 Apply local booking and preparation limits
The system SHALL accept online intake around the clock and evaluate standard handoff eligibility using Malaysia local time, the configured operating calendar, sellability, closures, preparation time and capacity. Same-day requests SHALL meet the 18:00 submission limit and 21:00 latest pickup or driver handoff. The eligibility read SHALL remain advisory until commitment.

Source: PRD-05, FN-CAL-01, FN-CAL-03; UAT-003 (standard), UAT-005. Tasks 2.4, 5.1–5.2.

#### Scenario: Valid same-day slot
- **WHEN** an order is submitted no later than 18:00 and can finish by a handoff no later than 21:00 on an open day with capacity
- **THEN** the time can be offered subject to final commitment revalidation

#### Scenario: After cutoff or insufficient lead time
- **WHEN** the request misses a cutoff or cannot satisfy the configured preparation time
- **THEN** the system does not promise that time and displays eligible alternatives when available

#### Scenario: Closed or full day
- **WHEN** a date is closed or has no remaining required units
- **THEN** the requested handoff is not eligible

### Requirement: CAT-03 Allocate day and product units together
All standard fulfilment modes SHALL share the configured daily unit limit and applicable per-product caps. A final commitment SHALL allocate against both limits atomically. Awaiting Cash acceptance or merchant fee consent SHALL NOT reserve units.

Source: PRD-06, FN-CAL-04; UAT-005–006, UAT-013. Tasks 2.4, 3.2–3.4, 4.1–4.5.

#### Scenario: Two buyers for last unit
- **WHEN** two requests that would exceed the same final capacity unit compete at commitment
- **THEN** only one secures the unit, and the losing request has no partial allocation

#### Scenario: Release and used capacity
- **WHEN** an unused hold is rejected, cancelled or expired, or an order is cancelled after preparation started
- **THEN** unused units are released once and used units remain counted

#### Scenario: Same-day remake
- **WHEN** an agreed reschedule requires new production on the same day after earlier units have been used
- **THEN** the used units remain counted and the new allocation succeeds only if all remaining capacity permits it

### Requirement: CAT-04 Review capacity and closure impact before applying
The system SHALL let the merchant edit weekly availability, future day/product limits and closure dates. Before confirming an affected-day change, it SHALL show affected orders and current occupied and used totals. It SHALL preserve existing promises and reject stale previews or limits below already occupied or used units.

Source: PRD-05–06, FN-CAL-01–02; UAT-005, UAT-013. Tasks 2.4, 5.2.

#### Scenario: Close a date with existing work
- **WHEN** the merchant reviews and confirms a closure against the current impact
- **THEN** new commitments are blocked while affected existing orders remain linked and actionable

#### Scenario: Stale preview or cap below used units
- **WHEN** a commitment or affected pending order changes the preview, or the cap is below protected units
- **THEN** the edit does not take effect and the merchant receives a refreshed or blocked impact view

### Requirement: CAT-05 Maintain product photos as a saved gallery
The system SHALL allow the merchant to preview, order, replace and remove product photos and attach valid photos through a successful product save. It SHALL show only the saved eligible gallery in the storefront and preserve the previous saved gallery on failure.

Source: BR-CAT-005–006, FN-CAT-02 and the scoped approval of SD-F02A. UAT-002. Tasks 2.3, 5.1–5.2.

#### Scenario: Upload and save a gallery
- **WHEN** the merchant selects and previews supported photos and saves the ordered gallery
- **THEN** the saved eligible product shows the same order and cover on the storefront

#### Scenario: Invalid, foreign or stale media edit
- **WHEN** media is invalid, belongs to another product or is submitted from a stale product version
- **THEN** the edit is rejected, staged media stays out of customer reads and the saved gallery remains intact
