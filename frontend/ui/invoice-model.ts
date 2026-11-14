import type { components } from "../contracts/event-invoices-v1";

export const sectionNames = {
  header: "Header",
  billing: "Billing and venue",
  items: "Line items and totals",
  payment: "Payment instructions",
  footer: "Notes and footer",
} as const;

type Schemas = components["schemas"];
export type InvoiceSection = Schemas["InvoiceSection"];
export type InvoiceKind = Schemas["InvoiceKind"];
export type InvoiceLogo = Schemas["InvoiceLogo"];
export type InvoiceTemplate = Schemas["InvoiceTemplate"];
export type TemplateState = Schemas["TemplateState"];
export type EventInvoices = Schemas["EventInvoices"];

export const templatePath = "admin/invoice-template";
export const invoiceKinds: Record<InvoiceKind, string> = { booking: "Booking invoice", extras: "Extras invoice" };

export function moveSection(order: InvoiceSection[], source: InvoiceSection, destination: number) {
  if (destination < 0 || destination >= order.length || order[destination] === source) return order;
  const next = order.filter(section => section !== source);
  next.splice(destination, 0, source);
  return next;
}
