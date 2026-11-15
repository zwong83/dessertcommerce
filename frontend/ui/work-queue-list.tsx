import Link from "next/link";
import { eventWorkTarget } from "./event-model";
import { Icon } from "./icons";
import { Time } from "./order-details";
import { label, workTarget } from "./standard-model";
import {
  workCategories,
  workStatusLabel,
  type WorkItem,
} from "./work-queue-model";

const reviewStatuses = new Set([
  "EXCEPTION",
  "UNCERTAIN",
  "DEAD",
  "PAYMENT_REVIEW",
  "REVIEW",
  "DEPOSIT_REVIEW",
]);

export function WorkQueueList({ items }: { items: WorkItem[] }) {
  return (
    <ul className="work-queue-items" aria-label="Work items">
      {items.map((item) => {
        const href = eventWorkTarget(item) ?? workTarget(item);
        const category = workCategories.find(
          (category) => category.kind === item.kind,
        )!;
        return (
          <li className="surface work-queue-item" key={item.id}>
            <div className="work-item-identity">
              <p className="work-item-kind">
                <Icon name={category.icon} size={16} />
                {category.title}
              </p>
              <h3>{item.number}</h3>
              <span
                className="work-status"
                data-review={reviewStatuses.has(item.status) || undefined}
              >
                {workStatusLabel(item.kind, item.status)}
              </span>
            </div>
            <div className="work-item-action">
              <span>Next action</span>
              <p>{item.safeNextAction}</p>
              {item.noticeOutcome && (
                <p className="work-notice-outcome">
                  Delivery outcome <strong>{label(item.noticeOutcome)}</strong>
                </p>
              )}
            </div>
            <div className="work-item-updated">
              <span>Last updated · MYT</span>
              <Time at={item.updatedAt} />
            </div>
            <div className="work-item-link">
              {href ? (
                <Link
                  className="button button-secondary"
                  href={href}
                  prefetch={false}
                  aria-label={`Open ${category.title.toLowerCase()} ${item.number}`}
                >
                  Open details <Icon name="arrow" size={16} />
                </Link>
              ) : (
                <span>Details unavailable</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
