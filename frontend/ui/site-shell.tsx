"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

type NavItem = { href: string; label: string; icon: IconName };

const shopNav: NavItem[] = [
  { href: "/shop", label: "Shop", icon: "cake" },
  { href: "/events", label: "Dessert tables", icon: "spark" },
  { href: "/orders", label: "Orders", icon: "list" },
  { href: "/cart", label: "Cart", icon: "bag" },
];

const merchantNav: NavItem[] = [
  { href: "/merchant", label: "Overview", icon: "grid" },
  { href: "/merchant/work", label: "Work queue", icon: "inbox" },
  { href: "/merchant/catalog", label: "Catalogue", icon: "cake" },
  { href: "/merchant/capacity", label: "Calendar", icon: "calendar" },
  { href: "/merchant/reports", label: "Reports", icon: "chart" },
  { href: "/merchant/invoice-template", label: "Invoice template", icon: "list" },
];

function currentSection(path: string, href: string) {
  if (path === href) return true;
  if (href === "/merchant") return false;
  if (href === "/cart" && path === "/checkout") return true;
  if (href === "/merchant/work" && /^\/merchant\/(orders|events|charges|notices)(\/|$)/.test(path)) return true;
  return path.startsWith(href + "/");
}

function Navigation({ items, path, label }: { items: NavItem[]; path: string; label: string }) {
  return <nav aria-label={label} className="shell-nav">
    {items.map(item => <Link key={item.href} href={item.href} prefetch={false}
      aria-current={path === item.href ? "page" : undefined} data-active={currentSection(path, item.href) || undefined}>
      <Icon name={item.icon} size={17} /><span>{item.label}</span>
    </Link>)}
  </nav>;
}

export function SiteShell({ children, merchant = false, displayName, customerSignedIn = false }: {
  children: ReactNode;
  merchant?: boolean;
  displayName?: string | null;
  customerSignedIn?: boolean;
}) {
  const path = usePathname();
  const merchantAuth = merchant && (path === "/merchant/login" || path === "/merchant/recover");
  const workspace = merchant && !merchantAuth;
  return <div className={workspace ? "site-shell workspace-shell" : "site-shell"}>
    <a href="#page-content" className="skip-link">Skip to content</a>
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="wordmark" href={workspace ? "/merchant" : "/"} aria-label={workspace ? "Gather Dessert merchant overview" : "Gather Dessert home"}>
          <span className="wordmark-icon"><img src="/gather-dessert-logo.webp" alt="" width={360} height={237} /></span>
          <span>Gather Dessert{merchant && <small>Merchant portal</small>}</span>
        </Link>
        {!merchant && <Navigation items={shopNav} path={path} label="Storefront" />}
        {merchant && <Link href="/" className="button button-quiet">Storefront <Icon name="arrow" size={15} /></Link>}
        {!merchant && customerSignedIn && <Link className="customer-display-name" href="/profile" aria-label="My account">
          <Icon name="user" size={17} /><span>{displayName ? "Hi, " + displayName : "My account"}</span>
        </Link>}
        {!merchant && !customerSignedIn && path === "/" && <Link className="button button-quiet site-sign-in" href="/login">Sign in</Link>}
      </div>
    </header>
    {workspace && <div className="workspace-navigation">
      <div className="workspace-navigation-inner">
        <p className="eyebrow">Operations</p>
        <Navigation items={merchantNav} path={path} label="Merchant navigation" />
      </div>
    </div>}
    <div className="shell-body">
      <div id="page-content" className="page-content" tabIndex={-1}>{children}</div>
    </div>
    <footer className="site-footer"><span>Gather Dessert</span><Link href={merchant ? "/" : "/merchant/login"}>{merchant ? "Customer storefront" : "Merchant sign-in"}</Link></footer>
  </div>;
}
