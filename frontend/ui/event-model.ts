import type { components, operations } from "../contracts/commercial-v1";
import { formText, isCalendarDate, mytDate, mytInput, uuid, type TransferAnswer } from "./standard-model";

export type EventBooking = components["schemas"]["Event"];
export type MerchantEvent = components["schemas"]["AdminEvent"];
export type EventSchedule = components["schemas"]["EventSchedule"];
export type EventCharge = components["schemas"]["Charge"];
export type Notice = components["schemas"]["NoticeDetail"];
export type EventRead<K extends keyof operations> = operations[K]["responses"] extends { 200: { content: { "application/json": infer T } } } ? T : never;
export type EventInput<K extends keyof operations> = operations[K] extends { requestBody: { content: { "application/json": infer T } } } ? T : never;

const dayMs = 86_400_000;
const maxMoney = 999_999_999;
const mytOffsetMs = 8 * 3_600_000;

export const eventStatuses: Record<EventBooking["status"], string> = {
  APPLIED: "Request received",
  QUOTED: "Quote available",
  AWAITING_DEPOSIT: "Awaiting deposit",
  DEPOSIT_REVIEW: "Deposit proof under review",
  BOOKED: "Booking confirmed",
  BALANCE_GRACE: "Balance in grace period",
  PROCEEDING: "Ready to proceed",
  EQUIPMENT_CHECK: "Equipment inspection",
  ADDITIONAL_BILL: "Extra invoice issued",
  COMPLETED: "Completed",
  EXPIRED: "Offer expired",
  CANCELLED: "Cancelled",
  DECLINED: "Declined",
  EXCEPTION: "Needs merchant review",
};

export const eventChargeNames: Partial<Record<EventCharge["category"], string>> = {
  EVENT_DEPOSIT: "Deposit", EVENT_BALANCE: "Original balance", EVENT_EXTRA: "Extra invoice",
};

export function customerEventStep(event: EventBooking) {
  if (event.safeOutcome) return event.safeOutcome;
  switch (event.status) {
    case "APPLIED": return event.alternativeSchedule ? "Review the alternate schedule suggested by the merchant." : "The merchant is reviewing your request.";
    case "QUOTED": return "Review the offered schedule, price and terms.";
    case "AWAITING_DEPOSIT": return "Open the deposit to review the amount and deadline.";
    case "DEPOSIT_REVIEW": return "The merchant is checking the transfer before confirming your booking.";
    case "BOOKED":
    case "BALANCE_GRACE": return "Check the current event schedule and original balance deadline.";
    case "PROCEEDING":
    case "EQUIPMENT_CHECK": return "Check the confirmed arrangements and service updates.";
    case "ADDITIONAL_BILL": return "Review the separate invoice and its payment deadline.";
    case "COMPLETED": return "Your event service is complete.";
    default: return "Open your event for the latest status.";
  }
}

export function eventText(form: FormData, name: string, title: string, max: number) {
  const value = formText(form, name);
  if (!value || value.length > max || value.includes("\0")) throw new Error("Check " + title + ".");
  return value;
}

export function eventInteger(form: FormData, name: string, title: string, min: number, max: number) {
  const value = formText(form, name);
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error("Enter " + title + " between " + min + " and " + max + ".");
  }
  return number;
}

export function moneyMinor(value: string, title: string, min: number) {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
  const amount = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : NaN;
  if (!Number.isSafeInteger(amount) || amount < min || amount > maxMoney) {
    throw new Error("Enter " + title + " in MYR with up to two decimal places.");
  }
  return amount;
}

export function eventDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value) || !isCalendarDate(value.slice(0, 10))) {
    throw new Error("Enter a valid date and time in MYT.");
  }
  return mytInput(value);
}

export function mytFormValue(instant: string) {
  return new Date(Date.parse(instant) + mytOffsetMs).toISOString().slice(0, 16);
}

export function earliestRequestDate(now: Date) {
  const local = new Date(now.getTime() + mytOffsetMs);
  const afterTen = local.getTime() - Date.parse(local.toISOString().slice(0, 10)) > 22 * 3_600_000;
  return dateOffset(mytDate(now), afterTen ? 8 : 7);
}

function dateOffset(date: string, days: number) {
  return new Date(Date.parse(date) + days * dayMs).toISOString().slice(0, 10);
}

export function requestPayload(form: FormData, now: Date): EventInput<"submitEventRequest"> {
  const eventDate = formText(form, "eventDate");
  if (!isCalendarDate(eventDate) || eventDate < earliestRequestDate(now)) {
    throw new Error("Choose a date that meets the seven-day MYT lead time.");
  }
  const time = (field: string) => eventDateTime(eventDate + "T" + formText(form, field));
  const setupReadyAt = time("setupReadyAt"), startAt = time("startAt"), expectedEndAt = time("expectedEndAt");
  if (setupReadyAt > startAt || startAt >= expectedEndAt) throw new Error("Enter setup, start and end times in order.");
  const email = formText(form, "notificationEmail");
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("Enter a valid notice email.");
  }
  const venue = {
    line1: eventText(form, "line1", "the street address", 200),
    city: eventText(form, "city", "the city", 100),
    postcode: eventText(form, "postcode", "the postcode", 20),
    region: eventText(form, "region", "the state or territory", 100),
    ...(formText(form, "line2") && { line2: eventText(form, "line2", "the venue address", 200) }),
    ...(formText(form, "note") && { note: eventText(form, "note", "the venue access notes", 300) }),
  };
  return {
    eventDate, startAt, expectedEndAt, setupReadyAt, venue,
    guestCount: eventInteger(form, "guestCount", "the guest count", 1, 100_000),
    budgetMinor: moneyMinor(formText(form, "budget"), "the budget", 0),
    occasion: eventText(form, "occasion", "the occasion", 120),
    theme: formText(form, "theme") ? eventText(form, "theme", "the theme", 120) : "None",
    specialRequirements: formText(form, "specialRequirements") ? eventText(form, "specialRequirements", "the special requirements", 1000) : "None",
    contactName: eventText(form, "contactName", "the contact name", 120),
    phone: eventText(form, "phone", "the phone number", 24),
    ...(email && { notificationEmail: email }),
  };
}

export function acceptancePayload(event: EventBooking, now?: number): EventInput<"acceptEventQuote"> | null {
  const quote = event.quote;
  return event.status === "QUOTED" && event.allowedActions.includes("ACCEPT_QUOTE")
    && quote?.status === "OFFERED" && (now === undefined || Date.parse(quote.depositDueAt) > now)
    ? { quoteId: quote.id, quoteVersion: quote.version, termsVersion: quote.termsVersion } : null;
}

export function eventCancellation(answer: TransferAnswer | null): EventInput<"cancelEventRequest"> | null {
  return answer === "none" ? { noTransferSent: true } : null;
}

export function schedulePayload(form: FormData): EventSchedule {
  const fields = ["setupReadyAt", "eventStartAt", "eventEndAt", "teardownAt"] as const;
  const dates = fields.map(field => formText(form, field));
  const [setupReadyAt, eventStartAt, eventEndAt, teardownAt] = dates.map(eventDateTime);
  if (setupReadyAt > eventStartAt || eventStartAt >= eventEndAt || eventEndAt > teardownAt
    || dates.some(value => value.slice(0, 10) !== dates[0].slice(0, 10))) {
    throw new Error("Enter setup, start, end and teardown in order on the same MYT date.");
  }
  return { setupReadyAt, eventStartAt, eventEndAt, teardownAt };
}

function resourceWindow(form: FormData, schedule: EventSchedule, now: number) {
  const startAt = eventDateTime(formText(form, "windowStartAt")), endAt = eventDateTime(formText(form, "windowEndAt"));
  if (startAt > schedule.setupReadyAt || endAt < schedule.teardownAt || Date.parse(startAt) <= now) {
    throw new Error("Choose a future resource window that covers setup through teardown.");
  }
  const firstDay = mytDate(new Date(startAt)), lastDay = mytDate(new Date(endAt));
  if (lastDay >= dateOffset(firstDay, 31)) throw new Error("Use a resource window of at most 31 calendar dates.");
  return { startAt, endAt };
}

export function quotePayload(form: FormData, rows: string[], now: number, billingRows: string[] = []): EventInput<"issueEventQuote"> {
  const schedule = schedulePayload(form);
  const depositDueAt = eventDateTime(formText(form, "depositDueAt")), balanceDueAt = eventDateTime(formText(form, "balanceDueAt"));
  const deposit = Date.parse(depositDueAt);
  if (deposit <= now || deposit > Date.parse(schedule.eventStartAt) - 4 * dayMs) {
    throw new Error("Choose a future deposit deadline at least four days before the offered start.");
  }
  if (depositDueAt >= balanceDueAt || mytDate(new Date(balanceDueAt)) !== dateOffset(mytDate(new Date(schedule.eventStartAt)), -3)) {
    throw new Error("Set the balance deadline on the MYT date three days before the offered event.");
  }
  if (rows.length > 100) throw new Error("Include up to 100 equipment items.");
  const totalMinor = moneyMinor(formText(form, "total"), "the quote total", 2);
  const invoiceLines = billingRows.map(row => ({
    description: eventText(form, "description-" + row, "the invoice line description", 200),
    quantity: eventInteger(form, "billing-quantity-" + row, "the invoice quantity", 1, 9999),
    unitPriceMinor: moneyMinor(formText(form, "unit-price-" + row), "the invoice unit price", 1),
  }));
  if (invoiceLines.length && invoiceLines.reduce((sum, row) => sum + row.quantity * row.unitPriceMinor, 0) !== totalMinor) {
    throw new Error("Invoice line amounts must add up to the quote total.");
  }
  return {
    totalMinor,
    ...(invoiceLines.length > 0 && { invoiceLines }),
    ...(formText(form, "billingName") && { billingName: eventText(form, "billingName", "the billing name", 120) }),
    ...(formText(form, "billingAddress") && { billingAddress: eventText(form, "billingAddress", "the billing address", 500) }),
    depositDueAt, balanceDueAt, schedule, resourceWindow: resourceWindow(form, schedule, now),
    packageSummary: eventText(form, "packageSummary", "the package summary", 1500),
    serviceSummary: eventText(form, "serviceSummary", "the service summary", 1500),
    extraChargeTerms: eventText(form, "extraChargeTerms", "the extra-charge terms", 1500),
    termsVersion: eventText(form, "termsVersion", "the current published terms version", 40),
    resourceAssessment: {
      staffCount: eventInteger(form, "staffCount", "the planned staff count", 1, 999),
      notes: eventText(form, "assessmentNotes", "the resource assessment", 1200),
    },
    equipment: rows.map(row => ({
      name: eventText(form, "name-" + row, "the equipment name", 120),
      quantity: eventInteger(form, "quantity-" + row, "the equipment quantity", 1, 999),
    })),
  };
}

export function balanceCutoff(event: EventBooking) {
  return event.effectiveBalanceGraceEndsAt ?? event.effectiveBalanceDueAt;
}

export function merchantCancellationOptions(event: MerchantEvent, overdue: boolean) {
  const options: [NonNullable<EventInput<"changeEventBooking">["cancellationBasis"]>, string][] = [];
  if (!event.allowedActions.includes("CANCEL")) return options;
  if (["APPLIED", "QUOTED", "AWAITING_DEPOSIT"].includes(event.status)
    && event.charges.every(charge => charge.state === "OPEN" && charge.paidMinor === 0 && !charge.reviewStatus)) {
    options.push(["CUSTOMER_REQUEST", "Customer requested cancellation before transfer"]);
  }
  const balance = event.charges.find(charge => charge.category === "EVENT_BALANCE");
  if (balanceCutoff(event) && overdue && ["BOOKED", "BALANCE_GRACE"].includes(event.status)
    && balance && (balance.state === "OPEN" || balance.state === "PROOF_REVIEW")
    && balance.paidMinor === 0 && !balance.reviewStatus) {
    options.push(["BALANCE_OVERDUE", "Original balance overdue after bank check"]);
  }
  if (event.status !== "APPLIED" && event.status !== "QUOTED") {
    options.push(["MERCHANT_UNABLE", "Merchant unable to fulfil"], ["FORCE_MAJEURE", "Force majeure"]);
  }
  return options;
}

export function merchantCancellationPayload(
  form: FormData, basis: ReturnType<typeof merchantCancellationOptions>[number][0],
): EventInput<"changeEventBooking"> {
  const reason = eventText(form, "reason", "the cancellation reason", 500);
  if (basis === "CUSTOMER_REQUEST" && form.get("noTransferSent") !== "on") throw new Error("Confirm the customer has sent no transfer.");
  if (basis === "BALANCE_OVERDUE" && form.get("noBalanceFundsReceived") !== "on") throw new Error("Confirm the bank receipt check.");
  return {
    action: "CANCEL", cancellationBasis: basis, reason,
    ...(basis === "CUSTOMER_REQUEST" && { noTransferSent: true }),
    ...(basis === "BALANCE_OVERDUE" && { noBalanceFundsReceived: true }),
  };
}

export function canReschedule(event: MerchantEvent) {
  const balance = event.charges.find(charge => charge.category === "EVENT_BALANCE");
  return event.allowedActions.includes("RESCHEDULE") && event.actualSetupAt === null && !event.equipmentLedger.length
    && event.charges.some(charge => charge.category === "EVENT_DEPOSIT" && charge.state === "PAID")
    && !!balance && (balance.state === "PAID" || (["OPEN", "PROOF_REVIEW", "DISPUTED"].includes(balance.state) && !balance.reviewStatus));
}

export function reschedulePayload(form: FormData, event: MerchantEvent, now: number): EventInput<"rescheduleEventBooking"> {
  const balance = event.charges.find(charge => charge.category === "EVENT_BALANCE");
  if (!balance || !canReschedule(event)) throw new Error("Review the booking and resolve any pending balance proof first.");
  const schedule = schedulePayload(form);
  const agreedAt = eventDateTime(formText(form, "agreedAt")), channel = formText(form, "channel");
  if (Date.parse(agreedAt) > now || (channel !== "PHONE" && channel !== "WHATSAPP" && channel !== "IN_PERSON")) {
    throw new Error("Record the channel and time when the customer agreed.");
  }
  let balancePlan: EventInput<"rescheduleEventBooking">["balancePlan"] = { state: "SETTLED", chargeId: balance.id };
  if (balance.state !== "PAID") {
    const dueAt = eventDateTime(formText(form, "replacementDueAt"));
    const due = Date.parse(dueAt);
    if (due <= now || mytDate(new Date(due)) !== dateOffset(mytDate(new Date(schedule.eventStartAt)), -3)) {
      throw new Error("Set a future balance deadline on the new MYT event date minus three days.");
    }
    balancePlan = { state: "AGREED_OUTSTANDING", chargeId: balance.id, dueAt, graceEndsAt: new Date(due + dayMs).toISOString() };
  }
  return {
    schedule, resourceWindow: resourceWindow(form, schedule, now),
    consent: { agreedAt, channel, reference: eventText(form, "reference", "the consent reference", 200) },
    reason: eventText(form, "reason", "the reschedule reason", 500),
    obligationDisposition: "KEEP_APPROVED_TERMS", balancePlan,
  };
}

export function equipmentOutPayload(form: FormData, equipment: NonNullable<EventBooking["quote"]>["equipment"]) {
  if (!equipment.length) throw new Error("The confirmed quote has no equipment to record.");
  return equipment.map(item => ({
    equipmentId: item.id, taken: eventInteger(form, "taken-" + item.id, "the number taken for " + item.name, 0, item.quantity),
  }));
}

export function equipmentCheckPayload(form: FormData, event: MerchantEvent) {
  const items = new Map(event.quote?.equipment.map(item => [item.id, item.name]));
  if (!event.equipmentLedger.length) throw new Error("The event has no recorded equipment to inspect.");
  return event.equipmentLedger.map(item => {
    const name = items.get(item.equipmentId);
    if (!name) throw new Error("Refresh the event to match the equipment ledger to the quote.");
    const count = (kind: string) => eventInteger(form, kind + "-" + item.equipmentId, kind + " quantity for " + name, 0, item.taken);
    const returned = count("returned"), damaged = count("damaged"), lost = count("lost");
    if (returned + lost !== item.taken || damaged > returned) {
      throw new Error("For " + name + ", returned plus lost must equal the number taken, and damaged counts toward returned.");
    }
    return { name, equipmentId: item.equipmentId, returned, damaged, lost };
  });
}

export function extrasPayload(form: FormData, rows: string[]) {
  if (!rows.length || rows.length > 40) throw new Error("Add between one and 40 extra invoice lines.");
  const lines = rows.map(row => ({
    item: eventText(form, "item-" + row, "the extra item", 120),
    reason: eventText(form, "reason-" + row, "the extra charge reason", 500),
    amountMinor: moneyMinor(formText(form, "amount-" + row), "the extra amount", 1),
  }));
  if (lines.reduce((sum, line) => sum + line.amountMinor, 0) > maxMoney) throw new Error("The extra invoice total exceeds the allowed amount.");
  return lines;
}

export function noticeResolution(form: FormData, notice: Notice): EventInput<"resolveNotificationFailure"> {
  if (notice.status !== "FAILED" && notice.status !== "UNKNOWN") throw new Error("Only failed or unknown notices can be resolved.");
  const disposition = formText(form, "disposition");
  if (disposition !== "MANUAL_CONTACT" && disposition !== "PROVIDER_RECONCILED") throw new Error("Choose how you resolved the notice.");
  return { disposition, reason: eventText(form, "reason", "the resolution reason", 500) };
}

export function eventChargePath(chargeId: string, eventId: string | null) {
  const path = "/merchant/charges/" + encodeURIComponent(chargeId);
  return eventId ? path + "?" + new URLSearchParams({ event: eventId }) : path;
}

export function eventWorkTarget(item: EventRead<"listMerchantWork">["items"][number]) {
  const { resourceType, resourceId, eventId, chargeId } = item.target;
  if (resourceType === "NOTICE" && uuid.test(resourceId)) return "/merchant/notices/" + resourceId;
  if (eventId && uuid.test(eventId) && chargeId && uuid.test(chargeId)
    && (resourceType === "PROOF" || resourceType === "PAYMENT_EXCEPTION")) return eventChargePath(chargeId, eventId);
  const id = eventId ?? (resourceType === "EVENT" ? resourceId : null);
  return id && uuid.test(id) ? "/merchant/events/" + id : null;
}
