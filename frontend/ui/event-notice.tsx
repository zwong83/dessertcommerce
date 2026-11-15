"use client";

import { Select } from "@/ui/select";
import { useState } from "react";
import { Confirm } from "./standard-forms";
import type { Session } from "./standard-model";
import { EventFeedback, EventForm, EventTextArea, useEventCommands } from "./event-forms";
import { noticeResolution, type Notice } from "./event-model";

export function NoticeResolution({ notice, session }: { notice: Notice; session: Session }) {
  const commands = useEventCommands(session);
  const [disposition, setDisposition] = useState("");
  return <>
    <EventFeedback commands={commands} />
    <p><button type="button" disabled={commands.busy} onClick={commands.refresh}>Refresh delivery status</button></p>
    {(notice.status === "FAILED" || notice.status === "UNKNOWN") && <EventForm commands={commands}
      legend="Record completed follow-up" submit="Record notice resolution"
      onSubmit={data => commands.json<"resolveNotificationFailure">("admin/notices/" + notice.noticeId + "/resolve", undefined,
        noticeResolution(data, notice), () => "Notice follow-up recorded in the audit history.")}>
      <p>Record what was already verified or completed. Use the provider’s outcome to avoid duplicate contact.</p>
      <p><label>Resolution<br /><Select name="disposition" required value={disposition} onChange={e => setDisposition(e.target.value)}>
        <option value="">Choose a resolution</option>
        <option value="MANUAL_CONTACT">Manual contact completed</option>
        <option value="PROVIDER_RECONCILED">Provider outcome verified</option>
      </Select></label></p>
      <EventTextArea name="reason" max={500}>Reason for the audit record</EventTextArea>
      <Confirm>I completed the selected follow-up and confirm this audit record.</Confirm>
    </EventForm>}
  </>;
}
