import Link from "next/link";
import { requirePageSession } from "@/server/http/page-session";
import { Logout } from "@/ui/logout";
import { Icon, type IconName } from "@/ui/icons";

const tasks: { href: string; title: string; description: string; icon: IconName }[] = [
  { href: "/merchant/work?kind=EVENT", title: "Dessert table bookings", description: "Review enquiries, prepare quotes and follow up on confirmed events.", icon: "spark" },
  { href: "/merchant/work?kind=PROOF", title: "Payment proof", description: "Review transfer evidence before confirming a receipt.", icon: "inbox" },
  { href: "/merchant/capacity", title: "Production calendar", description: "Plan available quantities, closures and event commitments.", icon: "calendar" },
  { href: "/merchant/catalog", title: "Product catalogue", description: "Manage desserts, variants, prices and photos.", icon: "cake" },
  { href: "/merchant/work?kind=NOTICE", title: "Notice follow-up", description: "Find delivery issues that need a response.", icon: "list" },
  { href: "/merchant/reports", title: "Reports", description: "Review verified receipts, refunds and order activity.", icon: "chart" },
];

export default async function MerchantWorkspace() {
  const session = await requirePageSession("ADMIN");
  return (
    <main>
      <header className="workspace-banner"><p className="eyebrow"><Icon name="grid" size={16} /> Gather Dessert operations</p>
        <h1>Merchant workspace</h1><p>Review what needs attention and manage your shop from one place.</p>
        <Link className="button" href="/merchant/work">Open work queue <Icon name="arrow" size={17} /></Link>
      </header>
      <nav aria-label="Merchant operations" className="workspace-grid">{tasks.map(task => <Link className="workspace-card" href={task.href} key={task.href} prefetch={false}>
        <span className="tile-icon"><Icon name={task.icon} /></span><div className="card-copy"><h3>{task.title}</h3><p>{task.description}</p></div><Icon name="arrow" size={17} />
      </Link>)}</nav>
      <div className="pagination">
      <Logout csrfToken={session.csrfToken} login="/merchant/login" />
      </div>
    </main>
  );
}
