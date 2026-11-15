import Link from "next/link";
import { notFound } from "next/navigation";
import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { ApiProblem } from "@/server/http/problem";
import type { EventRead } from "@/ui/event-model";
import { NoticeResolution } from "@/ui/event-notice";
import { Time } from "@/ui/order-details";
import { label, uuid } from "@/ui/standard-model";

export default async function MerchantNoticePage({ params }: { params: Promise<{ noticeId: string }> }) {
  const { accountId, role, csrfToken } = await requirePageSession("ADMIN");
  const { noticeId } = await params;
  if (!uuid.test(noticeId)) notFound();
  const notice = await readBackend<EventRead<"getMerchantNotice">>("admin/notices/" + noticeId).catch(error => {
    if (error instanceof ApiProblem && error.status === 404) notFound();
    throw error;
  });
  const sourceHref = notice.sourceType === "EVENT" ? "/merchant/events/" + notice.sourceId
    : notice.sourceType === "ORDER" ? "/merchant/orders/" + notice.sourceId : "/merchant/work";
  const sourceLabel = notice.sourceType === "WORK" ? "Work queue" : "Open related " + notice.sourceType.toLowerCase();

  return <main>
    <nav aria-label="Merchant"><Link href="/merchant/work?kind=NOTICE">Notice work</Link> · <Link href={sourceHref}>{sourceLabel}</Link></nav>
    <h1>Notice delivery</h1>
    <h2>{label(notice.milestone)}</h2>
    <p role="status">{label(notice.status)} · Recipient {label(notice.recipientRole).toLowerCase()}</p>
    <p>{notice.safeNextAction}</p>
    {notice.resolvedAt && <p>Follow-up recorded <Time at={notice.resolvedAt} /></p>}
    <h2>Delivery attempts</h2>
    {notice.attempts.length ? <ol className="item-list">{notice.attempts.map(attempt => <li key={attempt.attempt}>
      <h3>Attempt {attempt.attempt}</h3>
      <p>{attempt.channel === "WHATSAPP" ? "WhatsApp" : attempt.channel === "SMS" ? "SMS" : "Email"} · {label(attempt.outcome)} · <Time at={attempt.at} /></p>
      {attempt.safeReason && <p>{attempt.safeReason}</p>}
    </li>)}</ol> : <p>No delivery attempts recorded.</p>}
    <NoticeResolution key={accountId + ":" + notice.noticeId} notice={notice} session={{ accountId, role, csrfToken }} />
  </main>;
}
