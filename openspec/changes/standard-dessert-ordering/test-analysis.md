# Test Analysis · SweetCommerce Increment 1

Supplemental OpenSpec artifact · 9 November 2026 · Owner approval recorded for the first increment · Analysis only

## 1. Baseline and scope

[BRD 1.0-R2](../../../output/BRD/SweetCommerce/BRD-SweetCommerce.md), [PRD 1.2](../../../output/PRD/PRD-SweetCommerce.md), [SA 1.2](../../../output/SA/SA-SweetCommerce.md) and [SD 0.5 scope and approval](../../../output/SD/SD-SweetCommerce-index.md#review-and-approval) govern this analysis. DEC-022 and DEC-025 govern standard cancellation and top-up. SRS/FRS are owner-confirmed Not Applicable. The [proposal](proposal.md), five capability specs, [design and 49-operation scope](design.md#contract-operations-and-task-ownership), [OpenAPI 0.4.0](../../../output/SD/contracts/sweetcommerce-v1.0.4.openapi.json) and [tasks](tasks.md) are the change baseline. OpenSpec 1.2.0 uses the `spec-driven` schema. The TypeScript implementation and local PostgreSQL tests provide a runtime migration baseline. The remaining first-increment cases retain their planned status. UAT references are to the standard portion where shared.

## 2. Change impact and risk

New customer login/storefront/cart/checkout/order routes and separate merchant catalogue, capacity, work and settlement routes. The first increment adds application and worker entry points, PostgreSQL persistence and due work, private proof and media boundaries, synthetic OTP/notice adapters, and API fixtures. Business facts, actual bank receipts, queued work and provider outcomes have separate ownership. Phase 2 extends shared operations without changing the standard semantics.

| Risk | Exposure and priority | Mitigation and owner |
| --- | --- | --- |
| R01 · Account/role leakage, challenge replay and recovery race | High impact and low discoverability from happy paths. P0 | Verify actual boundary denial, session revocation and no private content in browser or logs. Identity and Security. |
| R02 · Stale edit or accidental media disclosure | Likely under retries or parallel edits. P1, private media P0 | Guard version and ownership, preserve prior saved state. Catalogue and Interface. |
| R03 · Overcommit, stale impact or wrong date | High impact and likely at cutoffs or contention. P0 | Clock boundaries, real concurrent PostgreSQL locks, no partial reservation. Capacity and Order. |
| R04 · Lost response, duplicate order or stale checkout promise | High impact and intermittent. P0 | Durable order intent and immutable scope, deterministic race replay. Order. |
| R05 · Misstated delivery/production or unauthorized new fee | Moderate likelihood and high financial or fulfilment impact. P0 | Separate operational facts, verify exact consent and failed recovery effects. Fulfilment. |
| R06 · Proof/expiry and top-up mistakes | High impact at timer boundaries and during worker delay. P0 | Freeze DB time, race proof and expiry, reconcile late funds. Settlement and Worker. |
| R07 · Duplicate receipt/refund, unsafe cancellation or no-show | High financial impact and difficult to detect on aggregate totals. P0 | Verify append-only unique movements, locked reservation, denial and audit. Settlement. |
| R08 · Misleading UI or inaccessible recovery | Likely across browsers or stale responses. P1, payment decisions P0 | Component keyboard/state checks and isolated journeys. Frontend. |
| R09 · Contract, migration, workload and recovery failure | High delivery impact, currently no runtime evidence. P0 | Run boundary fixtures, isolated PostgreSQL bootstrap/restore and bounded performance/security verification. Platform. |

## 3. Specialist routing and evidence

The route cell identifies one governing test level and one execution owner. Partition cases into independently reported examples when multiple variants are listed. P0 is the default for R01 and R03–R07/R09. R02 and R08 are P1 except ownership, private data or money assertions, which are P0. Test data is synthetic. Status for every row is **Planned**. Automated execution is the default except the separately labelled merchant acceptance check and visual review. Approval and authorization gates are in §6.

| Route | Governing specialist → execution owner | Prerequisite and environment | Output |
| --- | --- | --- | --- |
| U | unit-testing-standard → tdd-agent | Approved task and Apply permission, deterministic time and domain fixtures, no real dependencies | Named passing cases plus Red-Green-Refactor evidence |
| I | integration-testing-standard → integration-testing-agent | Isolated PostgreSQL 16 and worker/storage test boundary as applicable, independent transactions, barriers and cleanup | Assertions with before/after rows, versions, work keys and redacted timing |
| C | contract-testing-standard → contract-testing-agent | Approved OpenAPI subset, implemented provider and customer/merchant consumers or contract harness, versioned synthetic fixtures | Provider/consumer report with request/response shapes, status, effect and compatibility |
| UI | ui-testing-standard → ui-testing-agent | Approved interaction, supported mobile Safari/Chrome and desktop Chrome/Edge/Safari families, usable fixtures | UI report with exact browser builds, focus/status/contrast and viewport evidence |
| E | system-e2e-testing-standard → system-e2e-testing-agent | Isolated versioned web, worker and PostgreSQL, mock bank outcomes, fake delivery and OTP/notice adapters | Journey result, redacted IDs, committed state and cleanup |
| S | security-testing-standard → security-testing-agent | Explicit authorized isolated target, synthetic identities, scoped techniques and safety limits | Redacted authorization/privacy report and zero unintended mutations |
| P | backend-performance-capacity-standard → performance-testing-agent | Explicit load authorization, isolated instrumented target and resettable fixture | Latency, error, lag and invariant report with workload and raw evidence |
| R | regression-testing-standard → regression-testing-agent | Actual diff, selected suites, earlier specialist outputs and isolated target | Regression report with base, target, selectors, evidence and failures |
| A | Business acceptance → zwong | Reviewed synthetic standard flows and known launch exclusions | Manual acceptance or documented finding per relevant BRD UAT |

## 4. Test Case Matrix

Each source cell names the requirement and its OpenSpec scenario heading, or the governing design decision for supplemental cases. Route, priority, status, fixture class and evidence rules from §3 apply to every row. Dates and deadlines use MYT. Cutoff comparisons use the authoritative database clock where the case requires a real transaction.

### Identity and persistent cart · D02 · UAT-001/002/007/008/014/016

| ID | Source and scenario | Risk and partition | Fixture and exact action | Expected result and forbidden effects | Route | Task |
| --- | --- | --- | --- | --- | --- | --- |
| SC-01 | CUS-01 · Valid unused code | R01 positive | Verified phone A submits its fresh OTP in the correct challenge and role | One customer session permits A's own resources. No admin role or reusable code. | I | 2.1 |
| SC-02 | CUS-01 · Invalid expired or repeated code | R01 negative/boundary/failure | Submit incorrect, already consumed or foreign code. Compare one tick before five minutes, exactly at expiry and after. Simulate provider unavailable. | Unexpired valid input can succeed once. Invalid, reused, expired and unavailable branches issue no session and return safe feedback. | I | 2.1 |
| SC-03 | CUS-01 · Foreign customer data | R01 authorization | As A, read or mutate B's order/cart identifiers. Repeat while signed out. | Owner mismatch is non-disclosing and signed-out access requires sign-in. B's records and allocations stay unchanged. | S | 5.3 |
| SC-04 | CUS-01 · Logout clears access | R01 state/security | Sign in as A, open cart, log out, replay old session and sign in as B in same browser | Revoked session fails and A's private view is cleared before B can see its own cart. | UI | 5.1 |
| SC-05 | CUS-02 · Resume on another device | R04 positive/recovery | Add two eligible units on browser A. Open browser B under same verified phone after an inactivity interval. | Same authoritative quantities return with no inactivity expiry or production hold. | E | 2.2, 5.1 |
| SC-06 | CUS-02 · Stale cart update | R04 concurrency | Two browsers load version N. One commits quantity three, the other submits an edit with N. | Second write conflicts and refresh shows quantity three. No overwritten cart or allocation. | I | 2.2 |
| SC-07 | CUS-02 · Remove an item | R04 state | Remove the last unit of a cart line with an unrelated line present | Only the target line is removed. The other line and capacity stay unchanged. | U | 2.2 |
| SC-08 | CUS-02 · Cart quantity and reference subtotal | R04 positive/negative | Add two eligible units priced 450 sen. Try a negative quantity and an unavailable variant. | Subtotal is 900 sen. Invalid edits preserve the previous quantity and subtotal. No capacity reserved. | U | 2.2 |
| SC-09 | CUS-03 · Successful acceptance or repeated response | R04 replay/atomicity | Accept an order for two of three units, with another product present. Replay acceptance. | Purchased line becomes one unit, unrelated line remains and acceptance effects occur once. | I | 2.2, 3.3 |
| SC-10 | CUS-03 · Removal and re-add while order is pending | R04 concurrency | Remove and re-add a variant after an order snapshot is created, then accept the older order | New cart line generation stays intact. No subtraction from the replacement. | I | 2.2, 3.3 |
| SC-11 | CUS-03 · Failed or expired submission | R04 failure | Let a reviewed order expire without timely proof or reject it before acceptance | Existing cart quantities remain and any unused hold is released once. | I | 2.2, 4.1 |

### Catalogue and capacity · D03 · UAT-001–006/013

| ID | Source and scenario | Risk and partition | Fixture and exact action | Expected result and forbidden effects | Route | Task |
| --- | --- | --- | --- | --- | --- | --- |
| SC-12 | CAT-01 · Classified eligible product | R02 positive | List a product in a category with a 650-sen variant and flavour | Signed-in catalogue and detail show correct category, price and eligible choice. | C | 2.3, 5.1 |
| SC-13 | CAT-01 · Archived or suspended product | R02 state | Archive or suspend a previously purchased product and open new checkout and old order | New checkout cannot select it. Historical description and price remain as purchased. | I | 2.3 |
| SC-14 | CAT-01 · Draft and publication controls | R02 state | Create draft, list, unlist, suspend, mark sold out, restore, then archive | Eligible saves become visible. Each ineligible state rejects new selection and preserves historical orders. | I | 2.3, 5.2 |
| SC-15 | CAT-01 · Invalid catalogue edit | R02 negative | Submit missing required data, then stale version after another save | Show field or stale error and retain draft inputs. Previous saved product is unchanged. | UI | 2.3, 5.2 |
| SC-16 | CAT-02 · Valid same-day slot | R03 boundary | On an open day with capacity and feasible prep, submit at 18:00 with handoff at 21:00 | Both exact endpoints qualify. Availability remains advisory until commitment. | U | 2.4 |
| SC-17 | CAT-02 · After cutoff or insufficient lead time | R03 negative/boundary | Independently try 18:00 plus one tick, 21:00 plus one tick, and prep one tick longer than available | Each affected same-day option fails. Offer an eligible alternative when available and make no promise. | U | 2.4 |
| SC-18 | CAT-02 · Closed or full day | R03 negative | Query a closed date and then a date with zero remaining product or daily units | Neither option is eligible. Availability query makes no allocation. | U | 2.4 |
| SC-19 | CAT-03 · Two buyers for last unit | R03 concurrency | Race different fulfilment modes against one remaining daily/product unit under two DB transactions | Exactly one acquires the unit. Losing request leaves no partial day or product allocation. | I | 2.4, 3.2 |
| SC-20 | CAT-03 · Release and used capacity | R03 state/replay | Expire or cancel unused allocations, then merchant-cancel another order after prep began. Replay both. | Unused units released once. Used units remain counted. | I | 2.4, 4.3, 4.5 |
| SC-21 | CAT-03 · Same-day remake | R03 boundary | Request a consented same-day remake with earlier used units. Run with exactly enough and one fewer available unit. | First uses a new generation while retaining used history. Second preserves original promise and allocations. | I | 3.4 |
| SC-22 | CAT-04 · Close a date with existing work | R03 positive/state | Preview a closure with existing accepted orders, then confirm current preview | Shows affected orders and totals. Closure blocks new commitments without cancelling linked work. | I | 2.4, 5.2 |
| SC-23 | CAT-04 · Stale preview or cap below used units | R03 concurrency/negative | Create a pending Cash or fee order after preview. Separately propose a cap one unit below occupied/used. | Stale preview and invalid cap are rejected. Existing capacity policy and promises remain. | I | 2.4 |
| SC-24 | CAT-05 · Upload and save a gallery | R02 positive/boundary | Stage supported JPEG/PNG/WebP, save ordered gallery of 12 with a valid 5 MiB image, reorder or remove cover | Only the eligible saved gallery is customer-visible. Order and cover follow the last successful save. | C | 2.3, 5.1–5.2 |
| SC-25 | CAT-05 · Invalid, foreign or stale media edit | R02 negative/authorization | Test size limit plus one byte, 13th photo, bad signature, another product's media ID and stale save | Appropriate validation/scope/version failure. No staged media leak and previous saved gallery remains. | C | 2.3, 5.2 |

### Checkout and fulfilment · D03 · UAT-004/007–008/010–014

| ID | Source and scenario | Risk and partition | Fixture and exact action | Expected result and forbidden effects | Route | Task |
| --- | --- | --- | --- | --- | --- | --- |
| SC-26 | ORD-01 · Reviewed submission | R04 positive | Review pickup or one delivery address, contact, email if supplied, flavour, fees, terms and total. Submit current review twice. | One order number and exact snapshot. An unresolved merchant fee is shown as provisional and cannot be collected yet. | C | 3.1, 5.1 |
| SC-27 | ORD-01 · Review changed | R04 negative | Independently change cart version, contact, address, selection, terms, price or available handoff before submitting the old review | Each material change requires fresh review. No silently changed commitment or payment. | C | 3.1 |
| SC-28 | ORD-01 · Unknown submission outcome after reload | R04 concurrency/recovery | Lose the submit response. Race resolve/abandon against original submit under barriers. Repeat with each winning order. | Either return the one committed order or ensure the abandoned review can never later create one. | I | 3.1 |
| SC-29 | ORD-01 · Historical order after catalogue or terms change | R04 state | Pay for reviewed flavour and accepted terms, then publish new terms and edit the catalogue. Open owner GET and try changing order. | GET returns the original contact, fulfilment, flavour, amount and terms text. Paid customer edit is unavailable. | C | 3.1, 5.1 |
| SC-30 | ORD-02 · Merchant-delivery consent | R05 positive | Merchant offers one MYT slot and 900-sen fee. Customer accepts current revision with available capacity. | Accepted amount/terms bind that exact revision. A hold and transfer window start once. Before consent, no hold. | I | 3.2 |
| SC-31 | ORD-02 · Unserviceable or stale offer | R05 negative | Enter an unserviceable address and separately accept a superseded fee | No transfer window or fee collection. Provide eligible recovery or current offer without holding units. | C | 3.2 |
| SC-32 | ORD-02 · Customer-arranged delivery | R05 positive | Select customer-arranged Lalamove and record actual driver handoff after DuitNow verification | Order totals exclude external fee and show actual merchant handoff. Merchant does not book or collect that delivery fee. | E | 3.2, 3.3 |
| SC-33 | ORD-02 · Serviceable counteroffer before rejection | R05 state | Merchant proposes an alternate serviceable time and revised fee for an unserviceable original slot | Customer can see both revised terms and exact fee/time. Only explicit acceptance of that revision can begin payment. | UI | 3.2, 5.1–5.2 |
| SC-34 | ORD-02 · Fixed pickup point | R05 positive | Choose eligible pickup, switch between Cash and DuitNow and review | Shows configured pickup point and promised time, zero delivery fee and eligible methods. | UI | 3.2, 5.1 |
| SC-35 | ORD-03 · Normal fulfilment | R05 positive/state | Attempt out-of-sequence handoff, then merchant records accept, prepare, ready and handoff | Invalid transition changes nothing. Valid path retains promised and actual times and renders a customer-safe timeline. | E | 3.3, 5.2 |
| SC-36 | ORD-03 · Failed reallocation | R05 failure | Confirm exact reschedule consent but fill the target slot before committing it | Reallocation fails atomically. Original promise and allocation survive and merchant sees conflict. | I | 3.4 |
| SC-37 | ORD-03 · Extra delivery charge | R05 negative | Merchant tries to add 300 sen without documented consent, then with mismatched consent | Both requests fail without changing the original price or creating an extra charge. | C | 3.4 |
| SC-38 | ORD-03 · Successful consented recovery | R05 positive | Record incident and exact consent to redelivery at a feasible time with a separately approved extra amount | New promise and separate charge are linked to consent. Original totals, handoff facts and earlier used capacity stay intact. | I | 3.4 |
| SC-39 | ORD-03 · Driver arrival and incident without handoff | R05 state | Record arrival, pre-handoff incident, then actual handoff where eligible. In a separate order record an incident after handoff. | Arrival never marks handoff. Both exception paths preserve readiness and actual facts. Customer sees safe next action without private notes. | I | 3.3–3.4 |

### Settlement, expiry and refunds · D04–D05 · UAT-006/008–010/013–014/020

| ID | Source and scenario | Risk and partition | Fixture and exact action | Expected result and forbidden effects | Route | Task |
| --- | --- | --- | --- | --- | --- | --- |
| SC-40 | PAY-01 · Timely complete proof | R06 concurrency/boundary | Attach fully validated proof one DB tick before initial deadline while expiry worker contends | Timely proof keeps the hold pending review. No order acceptance or ledger entry from the upload alone. | I | 4.1, 4.5 |
| SC-41 | PAY-01 · No timely proof | R06 boundary | Run expiry with no proof, incomplete upload, and proof registration exactly at or after cutoff | No timely protection. Unused capacity is released once. Any valid late evidence stays on reconciliation path. | I | 4.1, 4.5 |
| SC-42 | PAY-01 · Late proof on an owned closed charge | R06 recovery | Upload complete valid evidence for an expired or cancelled owned charge | Open reconciliation work without reopening the order, posting an unverified receipt or restoring capacity. | C | 4.1 |
| SC-43 | PAY-01 · Foreign invalid or oversized proof | R06 negative/authorization | Use foreign charge ID, malformed JPEG/PNG/PDF, spoofed media, exactly 5 MiB valid proof and limit plus one byte | Foreign and invalid content fail without mutation. The exact valid size may register. Oversize fails and proof bytes stay private. | C | 4.1 |
| SC-44 | PAY-02 · Matched transfer | R07 positive | Merchant independently verifies a 2,000-sen transfer against 2,000 sen due with feasible held handoff | One verified receipt and one acceptance. If no longer feasible, the recorded funds enter the exception case without acceptance. | I | 4.2 |
| SC-45 | PAY-02 · Underpayment followed by a verified supplement | R06 positive/state | Record verified 1,500 sen on 2,000 due, issue request, verify separate 200 then 300-sen receipts with timely evidence | First subtotal stays open. Exact net total accepts once only while eligible. Distinct references post once each. | I | 4.2, 4.6 |
| SC-46 | PAY-02 · Duplicate or excess transfer | R07 replay/negative | Reuse one bank reference across requests and charges, then test verified total of 2,001 on 2,000 due | No duplicate or cross-charge movement. Excess follows reconciliation without automatic acceptance. | I | 4.2 |
| SC-47 | PAY-02 · Top-up proof just before the deadline | R06 boundary | Issue at 10:00, register proof just before 10:30, and delay merchant review past 10:30 | Capacity retained during review. Customer view distinguishes pending review from expiry. | I | 4.5–4.6 |
| SC-48 | PAY-02 · Top-up late or missing and expiry worker delayed | R06 boundary/failure | Issue at 10:00, delay worker, try proof exactly at 10:30 and later, and separately submit no proof | Neither late receipt nor delayed worker makes acceptance eligible. Release unused hold once and retain late or partial funds for reconciliation. | I | 4.5–4.6 |
| SC-49 | PAY-02 · Duplicate top-up notice and failed evidence | R06 replay/negative | Replay issuance and delivery attempt. In a separate run reject a proof without a terminal order action. | Original 30-minute deadline and notice identity persist. File rejection does not prove nonpayment or by itself reject the order. | I | 4.2, 4.6 |
| SC-50 | PAY-02 · Top-up notice delivery failure | R06 failure | Simulate timeout, known failure and unknown outcome after request issuance | Customer still sees amount and server deadline. Merchant sees follow-up. No order/charge/hold mutation from delivery outcome. | E | 4.6, 5.1–5.2 |
| SC-51 | PAY-02 · Timely top-up review ends without settlement after cutoff | R06 state | Start with timely proof and elapsed deadline. Resolve review without exact settlement, once with another timely proof pending and once without | Keep hold while other timely evidence is pending. Otherwise release unused capacity once and retain reconciliation records. | I | 4.2, 4.5–4.6 |
| SC-52 | PAY-03 · Cash pickup | R07 positive/atomicity | Merchant accepts eligible Cash pickup, then posts collection and actual pickup. Replay command. | Acceptance allocates once. Receipt and pickup commit together with one movement. | I | 4.3 |
| SC-53 | PAY-03 · Cash on delivery or no-show | R07 negative/concurrency | Attempt Cash with each Lalamove mode. Race Cash pickup posting with authorized no-show | Both delivery attempts reject Cash. Pickup and no-show are mutually exclusive. A winning no-show creates no receipt. | I | 4.3 |
| SC-54 | PAY-04 · Eligible customer cancellation | R07 positive/concurrency | Confirm no transfer for an owned unaccepted order. Separately race that action with qualifying proof registration. | With no contrary evidence, cancel once and release unused hold. Proof committed first blocks cancellation. Later evidence on a winning cancellation only reconciles. | I | 4.3 |
| SC-55 | PAY-04 · Sent or uncertain transfer before proof upload | R07 negative/UI | Select sent or unsure without uploading evidence. Replay via raw cancellation API against a second order with proof or disputed funds. | UI provides external WhatsApp contact without submitting cancellation. Server rejects conflicting evidence even with client confirmation. No state, refund or allocation change. | E | 4.3, 5.1 |
| SC-56 | PAY-04 · Concurrent or duplicate refund | R07 concurrency/boundary | With 1,000 refundable sen, race two 700-sen reserves and replay the successful payout | Committed reservations/postings never exceed 1,000 sen. Duplicate payout cannot add another movement. | I | 4.4 |
| SC-57 | PAY-04 · Uncertain payout then confirmed non-payout | R07 recovery | Record payout uncertainty, attempt another reservation for the same funds, then verify non-payout | Amount remains reserved while uncertain and releases only on the confirmed non-payout of the same intent. | I | 4.4 |
| SC-58 | PAY-04 · Merchant cannot fulfil | R07 positive/replay | Merchant records inability after partial refund and used prep. Retry cancellation and process remaining verified receipts | One obligation per affected verified receipt for the remaining amount. Used capacity remains counted and payout is never duplicated. | I | 4.4 |

### Merchant operations and delivery evidence · D01–D05 · UAT-008–010/013–014

| ID | Source and scenario | Risk and partition | Fixture and exact action | Expected result and forbidden effects | Route | Task |
| --- | --- | --- | --- | --- | --- | --- |
| SC-59 | OPS-01 · Authorized merchant | R01 positive | Sign in using enrolled admin challenge and open standard merchant work | Only verified admin session reaches protected work and sees scoped actions. | I | 2.1, 5.2 |
| SC-60 | OPS-01 · Customer or unenrolled principal | R01 authorization | Try admin challenge and protected proof/work as customer and unenrolled caller | Denied without admin provisioning, leaked channel identity, proof or business changes. | S | 2.1, 5.3 |
| SC-61 | OPS-01 · Verified recovery revokes earlier access | R01 concurrency | In separate runs recover via enrolled phone or email. Race contact reset with verification of an older challenge. | Recovery creates authorized access. No earlier session or challenge survives a committed reset. | I | 2.1 |
| SC-62 | OPS-01 · Loss of all enrolled channels | R01 negative | Try recovery supplying a new phone/email with neither enrolled channel available | Offer controlled manual support and issue no admin session or reset from self-supplied contact. Commercial identity-verification procedure is a launch check. | C | 2.1, 5.2 |
| SC-63 | OPS-02 · Merchant opens an unresolved payment item | R07 recovery | Create late proof and uncertain refund work items. Filter work and drill into each | Bounded typed work locates the correct protected record and current next action, including blocked payout. | C | 5.2 |
| SC-64 | OPS-02 · Guarded replay or unauthorized mutation | R07 replay/authorization | Replay authorized settlement action and then try it with a customer session | Exactly one business effect and one business audit. Denied attempt has no domain effect. | I | 5.2–5.3 |
| SC-65 | OPS-02 · Review of a confirmed change | R01 audit/privacy | Change fee, accept order, verify receipt and retrieve permitted audit evidence | Actor, action, time and safe reason are traceable. No proof bytes, contact, credential or provider body in audit or telemetry. | S | 5.3 |
| SC-66 | OPS-03 · Mobile or keyboard journey and recoverable failure | R08 accessibility/recovery | Exercise both role routes via keyboard and narrow viewport. Inject stale, empty and failed results and inspect visual contrast. | Visible focus, labelled actions, recoverable states, preserved applicable input and MYR/MYT output. No foreign data. | UI | 5.1–5.3, 6.1 |
| SC-67 | D01/D02 · Local application entry points | R09 integration | Run built web and separate worker with synthetic env and no production settings. Inspect module wiring and isolated role routes. | Local entry points work with reproducible commands. Module writes use ownership paths and unavailable dependencies cannot bypass guards. | I | 1.1 |
| SC-68 | D01/D05 · Bootstrap, migrate and compatibility | R09 migration/recovery | Apply reviewed first-increment schema to fresh PostgreSQL 16. Exercise constraints and least-privilege roles, then rehearse compatible roll-forward/rollback in isolation. | Stable keys and intended grants. No destructive data loss or broken compatible reader. | I | 1.2, 6.2 |
| SC-69 | D01–D05 · Full first-increment contract inventory | R09 contract | For each operation in the 49-operation design table, run the implemented provider and relevant role consumer against 0.4.0 fixtures. Include valid, malformed, denied, stale, cursor and version cases where applicable. | Provider/consumer reports enumerate all 49 operation IDs and applicable outcomes. Response, status, side effects and error shape match the approved subset. | C | 1.3, 6.1 |
| SC-70 | D02 · OTP abuse limits | R01 boundary/abuse | With a frozen clock, send three challenges per destination within 15 minutes then a fourth. Exercise verification up to the five-attempt limit, then try an extra guess and retry after policy permits. | Destination and attempt limits hold without creating an unauthorized session or leaking account state. Allowed retries still work under configured source/global budgets. | S | 2.1, 6.1 |
| SC-71 | D04/D05 · Fenced expiry and orphan evidence | R06 concurrency/recovery | Interrupt upload after object write and before metadata commit. Separately expire a worker lease, reassign work and deliver duplicate/stale completion. | Bounded cleanup handles unlinked evidence without removing referenced files. Only current lease may finalize and capacity release is single-effect. | I | 4.1, 4.5, 6.2 |
| SC-72 | D05 · Restore and reconcile in isolation | R09 recovery | Restore DB and private proof objects together with active holds, pending work and uncertain payout. Reconcile before restarting worker. | Proof references, committed movements, reservations, allocation and pending work agree. No duplicate payout or unsafe resend after recovery. | I | 6.2 |
| SC-73 | Backend SD §5 · Synthetic smoke | R09 performance | Isolated reviewed workload at 20 requests/s for 30 minutes with expiry worker active. Collect latency, error, lag and invariants. | p95 reads ≤500 ms, commitments ≤1 s, unexpected errors <1%, p95 expiry lag ≤60 s and zero invariant failures. These are synthetic build evidence. | P | 6.1 |
| SC-74 | D01–D05 · Cross-level regression and convergence input | R09 regression | Review actual diff and run impacted auth, order, capacity, settlement, work, contract and recovery suites. Record selectors, results and known flakes. | Affected cases pass or are explicitly diagnosed. No duplicate regression evidence and no unresolved material defect counted as complete. | R | 6.3 |
| SC-75 | BRD §20.2 · Standard acceptance | R08 acceptance | Merchant runs synthetic pickup, merchant and customer Lalamove, capacity conflict, proof/reconciliation and Cash/no-show walkthroughs. Review standard UAT IDs below. | Observable outcomes match the approved requirement and design. Record acceptance or precise discrepancy before convergence. | A | 6.1 |
| SC-76 | D01–D05 · Error and maintainability review | R09 regression | Inspect actual implementation diff for domain/adapter ownership, names, explicit null/typed error paths, safe effects and documentation of transaction invariants | Every finding links to changed code or verification evidence. Domain rejections retain stable typed outcomes and accepted effects remain idempotent. | R | 6.3 |

## 5. Coverage and task mapping

SC-01–SC-66 map one to one to the 66 capability scenario headings. SC-67–SC-76 cover cross-cutting implementation, migration, contract inventory, abuse limits, work recovery, smoke, regression and acceptance. Every scenario row has a task and all 23 planned task IDs have at least one case. SC-69 proves the HTTP contract, while real state, concurrency and role effects are checked independently at the level able to observe them. The source details and 49 API operations are enumerated in the design/specs and kept at that authority.

| BRD acceptance | Case anchors |
| --- | --- |
| UAT-001 / 002 | SC-01, SC-08, SC-12–SC-15, SC-24–SC-25 |
| UAT-003 standard / 005 / 006 | SC-16–SC-23, SC-30 |
| UAT-004 | SC-30–SC-33 |
| UAT-007 / 008 | SC-09–SC-11, SC-26–SC-29, SC-44–SC-46 |
| UAT-009 | SC-40–SC-51, SC-71 |
| UAT-010 | SC-34, SC-52–SC-53 |
| UAT-011 / 012 | SC-30–SC-33, SC-35–SC-39 |
| UAT-013 | SC-20–SC-23, SC-36–SC-39, SC-54–SC-58 |
| UAT-014 | SC-01–SC-04, SC-43, SC-59–SC-62, SC-65, SC-69–SC-70 |
| UAT-016 | SC-05–SC-11, SC-29 |
| UAT-020 top-up scope only | SC-49–SC-50, SC-71 |

UAT-015 and UAT-017–019, the event portion of UAT-003 and remaining UAT-020 notice coverage belong to increment 2. Negative and boundary categories apply to input guards, timing, media, allocations, refunds and retries. Exact numeric boundaries are not applicable to a presentation-only state like the order timeline, where the negative oracle is unauthorized access or a forbidden transition. Migration backfill and existing production compatibility are not applicable because this workspace has no prior application schema or deployment. Commercial configuration, retention, loss-of-all-channels runbook, real providers and banking are launch evidence under FN-ADM-06–07.

## 6. Execution and readiness

Use isolated PostgreSQL 16 schemas or containers, stable synthetic identities, separate customer and merchant sessions, fake provider/bank references and private sample objects. Set and reset authoritative time or fixed clocks. Concurrent tests use independently committed connections and explicit barriers. Run restore in a separate environment. Clear private browser state, remove scoped test objects and rows, and tear down test resources after each suite. Avoid real credentials, payment activity, contacts and notifications. Store evidence under the project-approved test output or link the retained runner result, with only redacted payloads.

Runtime entry requires implementation authorization and case prerequisites. Performance and security execution require a scoped authorized isolated target and limits. Cases are complete when the observed result records revision, case ID, environment, exact command, expected and actual outputs, prohibited effects and cleanup, with no unresolved material discrepancy. A flaky or skipped required case remains pending until disposition and evidence. Runtime, convergence and commercial acceptance are separate verdicts.

**TA-Ready for the increment 1 plan.** The owner-approved build scope has concrete cases, task routing and planned prerequisites. Execution evidence is pending. OpenSpec Apply requires explicit implementation authorization. No second-increment case or runtime result is claimed.

## Runtime migration verification

| Case | Scope and expected behavior | Apply task and verification owner |
| --- | --- | --- |
| PY-01 | OTP start/verify, admin recovery, old credentials, session/CSRF and logout preserve HTTP results and replay protection. Cart version, ownership, one-time commands and cross-device reads survive the runtime change. | 7.2 · API contract, domain and PostgreSQL integration |
| PY-02 | Catalogue drafts, publication, cursor, gallery order, old encrypted objects, byte validation and customer/admin media visibility preserve the checked behavior. | 7.2 · API contract and PostgreSQL integration |
| PY-03 | MYT eligibility boundaries, guarded cap edits, signed impact previews, pending-order staleness and concurrent last-unit allocation preserve behavior. | 7.2 · domain and PostgreSQL integration |
| PY-04 | Checkout, owned snapshots and command replay preserve the accepted wire shape, lock order and atomicity under submit/abandon and concurrent allocation. | 7.2 · API contract and PostgreSQL integration |
| PY-05 | The Python worker processes existing durable work under the worker role, fences stale leases, applies the exact deadline and releases capacity once. | 7.3 · domain and PostgreSQL integration |
| PY-06 | Existing migration ledger, grants and checksums stay valid. Next preserves session and response/error metadata across the real HTTP bridge and reads its server pages from FastAPI. | 7.4 · PostgreSQL, API contract and browser-facing regression |
