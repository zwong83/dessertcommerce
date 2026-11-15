import { eventStatuses, type EventRead } from "./event-model";
import { label, orderStatuses } from "./standard-model";
import type { IconName } from "./icons";

export type WorkItem = EventRead<"listMerchantWork">["items"][number];
export type WorkKind = WorkItem["kind"];
type WorkCategory = {
  kind: WorkKind;
  title: string;
  description: string;
  icon: IconName;
};

export const workCategories: WorkCategory[] = [
  {
    kind: "ORDER",
    title: "Orders",
    description: "Preparation & handoff",
    icon: "bag",
  },
  {
    kind: "EVENT",
    title: "Dessert table events",
    description: "Bookings & service",
    icon: "cake",
  },
  {
    kind: "PROOF",
    title: "Payment proof",
    description: "Review transfers",
    icon: "inbox",
  },
  {
    kind: "PAYMENT_EXCEPTION",
    title: "Payment exceptions",
    description: "Settlement & refunds",
    icon: "chart",
  },
  {
    kind: "NOTICE",
    title: "Notice follow-up",
    description: "Delivery & follow-up",
    icon: "list",
  },
];

export const workStatuses: Record<WorkKind, Record<string, string>> = {
  ORDER: orderStatuses,
  EVENT: eventStatuses,
  PROOF: {
    REVIEW: "Awaiting review",
    ACCEPTED: "Accepted",
    REJECTED: "Rejected",
  },
  PAYMENT_EXCEPTION: {
    OPEN: "Open",
    RESOLVED: "Resolved",
    RESERVED: "Reserved",
    UNCERTAIN: "Uncertain",
    POSTED: "Posted",
    VOIDED: "Voided",
  },
  NOTICE: {
    READY: "Queued",
    LEASED: "In progress",
    SUCCEEDED: "Succeeded",
    DEAD: "Failed",
    RESOLVED: "Resolved",
  },
};

export function workStatusLabel(kind: WorkKind, status: string) {
  return workStatuses[kind][status] ?? label(status);
}
