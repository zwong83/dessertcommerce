import Link from "next/link";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { ChangeCustomerPassword, CustomerProfileCard, type CustomerAccount } from "@/ui/customer-profile";
import { Icon } from "@/ui/icons";
import { Logout } from "@/ui/logout";

const sections = [
  { id: "profile", label: "Profile", href: "/profile", icon: "user" },
  { id: "security", label: "Password and security", href: "/profile?section=security", icon: "lock" },
] as const;

export default async function CustomerProfilePage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const session = await requirePageSession("CUSTOMER", "/profile");
  const { section } = await searchParams;
  const active = sections.find(item => item.id === section) ?? sections[0];
  const profile = await readBackend<CustomerAccount>("auth/customer/account");

  return <main className="account-page">
    <h1>My account</h1>
    <div className="account-layout">
      <aside className="account-sidebar">
        <nav className="account-nav" aria-label="Account">
          {sections.map(item => <Link key={item.id} href={item.href}
            aria-current={active.id === item.id ? "page" : undefined}>
            <Icon name={item.icon} size={18} />{item.label}
          </Link>)}
        </nav>
        <Logout csrfToken={session.csrfToken} login="/login" label="Log out" />
      </aside>
      {active.id === "profile" ? <CustomerProfileCard initialProfile={profile} csrfToken={session.csrfToken} startEditing={section === "edit"} />
      : <section className="surface account-panel">
        <h2>{active.label}</h2>
        {profile.username
          ? <ChangeCustomerPassword csrfToken={session.csrfToken} />
          : <p>This account uses phone login and has no password to change.</p>}
      </section>}
    </div>
  </main>;
}
