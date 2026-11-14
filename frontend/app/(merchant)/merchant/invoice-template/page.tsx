import { readBackend } from "@/server/http/backend-client";
import { requirePageSession } from "@/server/http/page-session";
import { templatePath, type TemplateState } from "@/ui/invoice-model";
import { InvoiceTemplateEditor } from "@/ui/invoice-template-editor";
import "./invoice-template.css";

export default async function InvoiceTemplatePage() {
  const session = await requirePageSession("ADMIN");
  const template = await readBackend<TemplateState>(templatePath);
  return <InvoiceTemplateEditor initial={template} csrfToken={session.csrfToken} />;
}
