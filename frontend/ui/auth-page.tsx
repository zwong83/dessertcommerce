import type { ReactNode } from "react";
import { Icon } from "./icons";

export function AuthPage({ merchant, title, description, asideContent, children }: {
  merchant?: boolean; title?: string; description?: string; asideContent?: ReactNode; children: ReactNode;
}) {
  return <main className="auth-page">
    <div className="auth-aside">
      <span className="tile-icon"><Icon name={merchant ? "grid" : "cake"} size={24} /></span>
      <p className="eyebrow">Gather Dessert</p>
      <p className="auth-aside-title">{merchant ? "Merchant portal" : "A sweet welcome"}</p>
      <p>{merchant ? "Manage the shop, orders and dessert table bookings in one place." : "Order desserts, plan a celebration, and keep track of everything in one place."}</p>
      {asideContent}
    </div>
    <div className="auth-panel">{title && <h1>{title}</h1>}{description && <p>{description}</p>}{children}</div>
  </main>;
}
