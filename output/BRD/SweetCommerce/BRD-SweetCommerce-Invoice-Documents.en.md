# SweetCommerce Business Requirements — Event Invoice Documents

| Document control | Value |
| --- | --- |
| Project | SweetCommerce / Gather Dessert |
| Version and status | 0.3 · Draft for business review |
| Date | 13 November 2026 |
| Currency and time zone | Malaysian Ringgit (MYR) · Malaysia time (MYT) |
| Business owner | Gather Dessert approval representative · name TBC |
| Intended reviewers | Merchant staff responsible for event bookings, billing, and payment verification |
| Change scope | Dessert-table booking invoices and separate post-event extras invoices |

## 1. Business need and objectives

Customers can review a dessert-table quotation and payment charges in SweetCommerce. After the event, customers and merchants can see extra-charge line items. Customers need to download their issued invoices as PDFs. Authorized merchant staff need to design the invoice template used to produce those PDFs.

The supplied Gather Dessert invoice illustrates the primary use case: a bill for the original event booking with service and delivery details, itemized charges, and payment instructions. The proposed release covers that document and gives the existing post-event extras bill its own document.

| Objective | Proposed acceptance measure |
| --- | --- |
| Produce an invoice that a customer can use outside SweetCommerce | Both document types download as PDFs from the customer's event detail. An A4 PDF retains all lines and totals without clipping. |
| Let merchant staff control the design | An authorized merchant can save, preview, and publish a template revision. Newly issued PDFs use the published design, and previously issued PDFs retain their original design. |
| Keep billing consistent with the event and settlement records | Every tested invoice reconciles to its source amounts to the sen. An invoice and a payment submission do not establish verified settlement. |
| Give customers and merchant staff a reliable reference | Both authorized parties can retrieve the same issued version and invoice number. Repeated issuance attempts produce one original document per eligible billing record. |

These are proposed release acceptance measures. No production usage targets or release dates are committed.

## 2. Current requirements and code

| Area | What exists today | Gap for invoice documents |
| --- | --- | --- |
| Original booking | The event application captures the venue and contact. The versioned quote has package and service summaries, schedule, terms, total, deposit, balance, and deadlines. A verified eligible deposit confirms the booking. [Event input and quote rules](../../../backend/sweetcommerce/events/domain.py) · [Event projection](../../../backend/sweetcommerce/events/projection.py) · [PRD](../../PRD/PRD-SweetCommerce.md) | A separate invoice issue step, invoice number, billed-to details, and itemized prices. The current quote captures one total with free-text summaries. Equipment counts are operational data. |
| Post-event extras | After teardown and inspection, the merchant can issue one separate charge with item, reason, and amount. The system stores the lines with a quote reference and terms version and notifies the customer. The two event views show the line items. [Issue logic](../../../backend/sweetcommerce/events/application.py#L434) · [Shared line-item view](../../../frontend/ui/event-details.tsx#L78) | A downloadable PDF with an invoice number, issue date, and issuer and customer details. Existing extras lines have no quantity or unit price. |
| Template design | The supplied PDF shows Gather Dessert's existing invoice layout. The current merchant application has no invoice template editor or preview. | Merchant controls to design, preview, and publish the template used for newly issued PDFs. |
| Payment and documents | Deposit, original balance, and extras are tracked separately. The event service already checks that extras are independently paid before closing an event on that path. PDF support exists for uploaded payment proofs. [Closure specification](../../../openspec/changes/dessert-table-service/specs/dessert-table-service-closure/spec.md) · [Payment proof handling](../../../backend/sweetcommerce/proofs/infrastructure.py) | An invoice generation and retrieval capability. A payment-proof upload does not produce an invoice or verify payment. |

**Requirements baseline.** The [SweetCommerce BRD](BRD-SweetCommerce.md) covers the event quote, booking, equipment, and additional billing in BR-EVT-003–007 and BR-PAY-012. The [PRD](../../PRD/PRD-SweetCommerce.md) provides the detailed quote, payment, cancellation, reschedule, and extras rules in PRD-14–17 and FN-EVT-03–09. The supplied invoice PDF is a private layout reference.

## 3. Users and scope

| Role | Responsibility |
| --- | --- |
| Customer | Download issued invoices for their own event as PDFs. Use the event page to check payment progress. |
| Authorized merchant staff | Design, preview, and publish the invoice template. Maintain billing details and approved payment instructions, review original invoice line items, issue extras through service closure, and resolve document exceptions. |
| Gather Dessert business owner | Approve when to issue invoices, what they contain, and how exceptions and corrections are handled. |

**Proposed first release.** One original event invoice for the confirmed booking, with the deposit and original balance shown separately within that document. One separate invoice for an issued extras charge where applicable. Customers access both through a PDF download action on their event detail page. Authorized merchant staff manage the template in the merchant area. Use the supplied PDF as the starting design.

**Deferred or outside scope.** Standard retail order invoices, quotations exported as PDFs, separate deposit and balance invoices, receipt PDFs, automatic sending of PDF attachments, and bulk generation for older bookings. Any statutory e-Invoice, tax, or submission requirements that apply must be established before release. See INV-DEC-05.

## 4. Functional business requirements

Customer PDF-only access and merchant template design are confirmed. Preview, publication, and the specific design controls are proposed for the first release. The remaining requirements are proposed unless they restate an existing rule from Section 5.

| ID | Requirement | Priority | Acceptance condition |
| --- | --- | --- | --- |
| BR-INV-001 | Issue one original invoice against the accepted quote when the eligible verified deposit confirms the booking. If required billing data is missing, the merchant can complete it and issue against that same booking. | Must | A draft offer, quote acceptance, or pending proof produces no original invoice. Repeated processing after confirmation results in one original invoice. |
| BR-INV-002 | The merchant must be able to record billable package, service, setup, and delivery lines where applicable. The invoice must use the customer-agreed breakdown and show the original total, deposit and original balance as distinct amounts. | Must | Billable lines sum exactly to the accepted total. Deposit plus original balance equals that total. Any change to the agreed price or scope goes through the applicable agreement process before it can appear on an invoice. |
| BR-INV-003 | Provide a separate invoice document when the merchant issues an eligible extras charge through event closure. Show each extra item, reason, and amount, plus the total and effective due date. | Must | The same issue action produces one extras document. The extras document matches the separate charge and leaves the original invoice and original balance untouched. An event with no extras has no extras invoice. |
| BR-INV-004 | Use the merchant's published template and approved issuer details. Show invoice type, unique invoice number, issue date, event reference, relevant event or delivery schedule, billed-to and venue information, line items, MYR total, and applicable payment instructions. | Must | Each PDF identifies the invoice and uses separate billed-to and venue sections. Show quantity, unit, and unit price where recorded. For amount-only lines, omit unavailable values. |
| BR-INV-005 | Provide a PDF download as the customer's sole invoice action in SweetCommerce. Authorized merchant staff can retrieve the issued PDF for support. | Must | The event owner can download the PDF from their event detail. The customer has no in-app invoice preview, print action, or editing controls. An unrelated account or signed-out visitor cannot retrieve the PDF through a copied link. Retrying a failed download returns the same issued version. |
| BR-INV-006 | Preserve what was issued and provide a traceable merchant process for approved corrections. | Must | A profile change or reschedule leaves historical copies intact. An approved replacement or void identifies the original and reason, with the current version clear to customers and staff. A document correction alone does not alter amounts owed, refund funds, or verify settlement. |
| BR-INV-007 | Show current payment status on the event page alongside the issued invoice. On the invoice, label any payment amounts or deadlines captured at issue time with their effective date or context. | Must | Pending evidence is shown as under review. Paid status appears only after verification. Subsequent settlement or rescheduling updates the event page without rewriting the issued document. |
| BR-INV-008 | Produce readable A4 PDFs for long descriptions and multi-page invoices. | Must | Line content and the total remain legible and complete. Additional pages identify the invoice and repeat line headers when a table continues. |
| BR-INV-009 | Show the total in words if Gather Dessert wants that element from the sample. | Should | The wording matches the numeric MYR total, including sen. The approved wording language is used consistently. |
| BR-INV-010 | Let authorized merchant staff choose a section of the invoice template and configure it independently. Let them choose which optional sections appear and arrange sections within the supported layout. | Must | A merchant can select a section, edit its allowed settings, and see the result in the draft preview. Optional sections can be shown or hidden. Required invoice fields stay visible, and design controls cannot change recorded amounts, due dates, or payment status. Customer accounts cannot access template controls. |
| BR-INV-011 | Let authorized merchant staff save a draft, preview both invoice types, and publish a template revision for future issuance. | Must | Draft edits stay out of issued PDFs. A newly issued PDF uses the published revision, and PDFs already issued keep their original layout and content. |

### Proposed section settings

| Section | Merchant controls | Required content |
| --- | --- | --- |
| Header | Logo, brand colors, and title styling | Invoice type, invoice number, issue date, and approved issuer details |
| Billing and venue | Section headings and supported placement | Event reference, billed-to and venue details, and applicable schedule |
| Line items and totals | Column headings and table styling | Recorded line descriptions, amounts, and MYR totals. Quantity and unit price appear where recorded. |
| Payment instructions | Heading and supported placement | Approved instructions and applicable payment amounts and due dates |
| Notes and footer | Optional text and visibility | Any approved wording required for the invoice type stays visible |

The proposed editor presents a list of sections. Selecting a section opens its settings alongside the PDF preview. For sections that can move, the proposed controls are drag-and-drop and Move Up or Move Down buttons.

## 5. Existing rules and sample differences

| Topic | Existing SweetCommerce rule | Proposed document treatment |
| --- | --- | --- |
| Deposit | Event payments use DuitNow. Deposit is 50%, rounded up to a whole sen. Its deadline is the earlier of quote issue plus three days and the merchant-set deadline, which can be no later than four days before the event. | Show the recorded deposit and relevant payment context for the document. |
| Original balance | Ordinarily due three days before the event in MYT, with 24 hours of grace. Late verification of timely deposit proof and agreed rescheduling can change the effective deadline under the baseline. | Use the actual effective deadline at issue. The sample’s one-week term requires a separate policy decision if Gather Dessert wants to adopt it. |
| Extras | Eligible waiting, staffing, equipment damage or loss, and disclosed extras are billed separately. Payment is by DuitNow and due 48 hours after recorded actual event end. Settlement is independently verified. | Show the due date and time in MYT on the extras invoice. Keep extra amounts outside the original invoice totals. |
| Cancellation and refunds | Customer cancellation is available before the first transfer. Merchant inability to fulfil requires refund of verified receipts. Other exceptions follow the existing event policy. | Use approved event terms. The sample’s blanket no-refund wording and C.O.D. label are outside the proposed event terms. |
| Payment instructions | The event payment method is DuitNow. | Use Gather Dessert’s approved payment instructions and public contact details. Confirm which payment identifiers, if any, appear on the PDF. |

## 6. Document data and exceptions

| Data | Business rule or source |
| --- | --- |
| Issuer | Use approved Gather Dessert trading or legal name, applicable registration details, business address, and public contact. Branding and optional footer wording require approval. |
| Billed-to party | Use confirmed billing name and the billing address when required. Event intake currently has a contact and venue. Obtain a separate billing address or explicit confirmation that it matches the venue. Include only approved customer contact fields needed for billing. |
| Event and venue | Use the event reference and applicable accepted venue and schedule at issuance. Display the agreed delivery or setup time with a clear label. Show the actual event end when relevant to the extras deadline. |
| Amounts | The original invoice uses the agreed line breakdown and total. Extras use their recorded amounts and reasons. Where older records have only a package total, a single accurately labelled package line is an option subject to INV-DEC-03. |
| Invoice identity and history | The issuer, billed-to details, commercial content, issue date, and published template revision are preserved for each issued version. Use an invoice number unique within the approved numbering scope. Retention and correction rules are pending approval. |
| Missing or inconsistent data | Show the merchant which required information needs attention. Keep the existing booking, proof submission, and payment verification available. If an extras charge has already been created, use its original amount and deadline when resolving the document issue. |

## 7. UAT and release acceptance

| ID | Scenario | Expected outcome | Requirements |
| --- | --- | --- | --- |
| UAT-INV-01 | Accept a quote, submit proof, verify the eligible deposit, then retry issuance. | No invoice during proof review. One original invoice after eligibility and completeness, with the accepted quote and one stable number. | BR-INV-001, BR-INV-007 |
| UAT-INV-02 | Invoice a dessert package with separately agreed setup and delivery, different billing and venue addresses, and an odd total in sen. | All agreed lines and addresses are present. The total and instalments reconcile exactly, including deposit rounding. The effective deadline is accurate. | BR-INV-002, BR-INV-004, BR-INV-007 |
| UAT-INV-03 | Issue a staffing or damage charge after inspection, retry issuance, then verify its payment. Include an event with no extras. | One extras invoice with the correct due time and exact amount. Original invoice and balance stay intact. Review becomes paid only after verification. No extras document for the event without extras. | BR-INV-003, BR-INV-007 |
| UAT-INV-04 | Download an invoice as the owner and as authorized merchant staff. Check customer actions, try the same link as another customer and a signed-out visitor, then retry a failed download. | Authorized parties retrieve the same issued PDF. PDF download is the only customer invoice action. Unauthorized requests are denied. Retrying succeeds without issuing another invoice. | BR-INV-005 |
| UAT-INV-05 | Change contact details or reschedule. Follow the approved correction process, then open the history. | The historical invoice is unchanged. The effective schedule and deadline are visible on the event page. The approved correction is traceable, and the ledger is unaffected by a document-only change. | BR-INV-006, BR-INV-007 |
| UAT-INV-06 | Download a long multi-page invoice and an amount-only extras invoice. Test missing required billing details. | No clipping, fictitious unit prices, or missing totals. The merchant sees missing details and can complete them without blocking the event’s payment workflow. If total in words is enabled, it matches the numeric total. | BR-INV-001, BR-INV-004, BR-INV-008, BR-INV-009 |
| UAT-INV-07 | As a merchant, select Header and change the logo. Select Notes and footer and hide the optional footer. Move a supported section, save a draft, preview both invoice types, and publish. Try to hide a required field and access the editor as a customer. | The preview shows the new logo, omits the optional footer, and reflects the new section order. Required fields and recorded payment data are protected, and the customer cannot use the editor. Newly issued invoices use the published design. Earlier invoices and invoices issued while the change was a draft retain their original design. | BR-INV-010, BR-INV-011 |

Release acceptance requires business approval of the decisions below, a merchant review of both PDF types using a published template, and passing the applicable UAT scenarios. Verify that authorized staff can retrieve a previously issued version after recovery and that the original payment and closure journeys still pass. No release date is committed.

## 8. Risks and dependencies

| Risk | Business impact and mitigation |
| --- | --- |
| Quote summaries do not carry prices by line | A sample-style breakdown cannot be reconstructed reliably. Capture agreed line items going forward and approve a fallback for older eligible bookings. |
| Sample terms conflict with the existing event workflow | Customers could receive incorrect due dates or payment instructions. Use current policy and obtain separate approval for any policy change. |
| Personal or business details are copied from the sample | An issued PDF could expose a customer's data or contain outdated instructions. Use approved issuer details and the actual event's billing data. Restrict in-app access. |
| Issued documents diverge after payment or a reschedule | Customers may rely on old deadlines. Preserve issue history, expose current information on the event page, and approve when a replacement document is warranted. |
| Template changes hide required billing details | Customers could receive incomplete PDFs. Protect required fields and let merchant staff preview both document types before publishing. |

## 9. Open business decisions and approval

| ID | Decision | Draft proposal | Status |
| --- | --- | --- | --- |
| INV-DEC-01 | Which invoice types launch, and when is the original issued? | Launch original and extras PDFs together. Issue the original at verified-deposit booking confirmation. Decide if a pre-deposit billing document or split invoices are also required. | Open |
| INV-DEC-02 | Which settings are editable in each section, and which sections are optional? | Start with the section settings in Section 4. Confirm which sections can move or be hidden, which issuer details and payment instructions must appear, and whether the merchant needs separate layouts for original and extras invoices. | Open |
| INV-DEC-03 | What should happen to bookings with no agreed line breakdown or complete billing details? | Start with new bookings. Permit older bookings on request only if the merchant can verify the data. Approve whether one accurately labelled package line is acceptable where only the agreed package total exists. | Open |
| INV-DEC-04 | What numbering, correction, void, and retention rules apply? | Approve the series, starting point, authorized staff, correction or reissue triggers, and retention period. Determine whether the series must follow an existing Gather Dessert sequence. | Open |
| INV-DEC-05 | What statutory or tax requirements apply to this document and this release? | Gather Dessert confirms applicability with its finance or accounting adviser and decides whether any separate compliance work is needed before release. | Open |

Gather Dessert’s business owner is the proposed approver. Approval is pending. The next step is to confirm INV-DEC-01 through INV-DEC-05 and approve the release scope before detailed design.
