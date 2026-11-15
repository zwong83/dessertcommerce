"use client";

import { Select } from "@/ui/select";
import { useEffect, useState } from "react";
import { ErrorMessage } from "./error-message";
import { Icon } from "./icons";
import { TemplateSectionSettings, type UpdateSection } from "./invoice-template-settings";
import { invoiceKinds, invoiceLogoFormats, invoiceLogoMaxBytes, moveSection, sectionNames, templatePath, type InvoiceKind, type InvoiceSection, type TemplateState } from "./invoice-model";
import { prepareMutation, previewInvoicePdf, sendStandard } from "./standard-api";

export function InvoiceTemplateEditor({ initial, csrfToken }: { initial: TemplateState; csrfToken: string }) {
  const [saved, setSaved] = useState(initial);
  const [template, setTemplate] = useState(initial.draft);
  const [selected, setSelected] = useState<InvoiceSection>("header");
  const [dragging, setDragging] = useState<InvoiceSection | null>(null);
  const [dropTarget, setDropTarget] = useState<InvoiceSection | null>(null);
  const [kind, setKind] = useState<InvoiceKind>("booking");
  const [zoom, setZoom] = useState("fit");
  const [preview, setPreview] = useState<string[]>([]);
  const [previewPending, setPreviewPending] = useState(true);
  const [previewError, setPreviewError] = useState("");
  const [previewRetry, setPreviewRetry] = useState(0);
  const [action, setAction] = useState<"draft" | "publish" | null>(null);
  const [readingLogo, setReadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<{ message: string; revision: number } | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const currentIndex = template.order.indexOf(selected);
  const dirty = JSON.stringify(template) !== JSON.stringify(saved.draft);

  useEffect(() => {
    const request = new AbortController();
    const timeout = setTimeout(async () => {
      setPreviewPending(true);
      setPreviewError("");
      try {
        const result = await previewInvoicePdf(templatePath + "/preview/" + kind, template, csrfToken, request.signal);
        if (!request.signal.aborted) setPreview(result.pages);
      } catch (cause) {
        if (!request.signal.aborted) setPreviewError(cause instanceof Error ? cause.message : "Could not update the PDF preview.");
      } finally {
        if (!request.signal.aborted) setPreviewPending(false);
      }
    }, 350);
    return () => {
      clearTimeout(timeout);
      request.abort();
    };
  }, [template, kind, csrfToken, previewRetry]);

  const update: UpdateSection = (section, patch) => {
    setTemplate(current => ({ ...current, [section]: { ...current[section], ...patch } }));
    setStatus("");
  };

  function reorder(section: InvoiceSection, destination: number) {
    setTemplate(current => ({ ...current, order: moveSection(current.order, section, destination) }));
    setSelected(section);
    setStatus(sectionNames[section] + " moved to position " + (destination + 1) + ".");
  }

  function reportLogoError(message: string) {
    setLogoError(previous => ({ message, revision: (previous?.revision ?? 0) + 1 }));
  }

  async function replaceLogo(file: File) {
    const mediaType = invoiceLogoFormats.find(format => format === file.type);
    if (!mediaType || file.size === 0 || file.size > invoiceLogoMaxBytes) {
      reportLogoError("Choose a PNG, JPEG or WebP image up to 2 MiB.");
      return;
    }
    setLogoError(null);
    try {
      setReadingLogo(true);
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
        reader.onerror = () => reject(new Error("Could not read the logo."));
        reader.readAsDataURL(file);
      });
      update("header", { logo: { mediaType, data } });
      setStatus("Logo updated in the draft.");
    } catch {
      reportLogoError("Could not read the logo. Choose the file again.");
    } finally {
      setReadingLogo(false);
    }
  }

  function restoreDefaultLogo() {
    setLogoError(null);
    update("header", { logo: null });
    setStatus("Default logo restored in the draft.");
  }

  async function save(mode: "draft" | "publish") {
    if (action) return;
    setAction(mode);
    setError("");
    setStatus("");
    try {
      const result = await sendStandard<TemplateState>(prepareMutation({
        path: templatePath + "/" + mode, method: mode === "draft" ? "PUT" : "POST",
        version: saved.version, json: { template },
      }), csrfToken);
      setSaved(result);
      setTemplate(result.draft);
      setStatus(mode === "draft" ? "Draft saved." : "Template published for future invoices.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the invoice template.");
    } finally {
      setAction(null);
    }
  }

  return <main className="invoice-editor">
    <header className="invoice-editor-heading">
      <div><h1>Invoice template editor</h1>
        <span className="invoice-editor-badge">{dirty ? "Unsaved draft" : saved.hasUnpublishedChanges ? "Draft saved" : "Published"}</span>
      </div>
      <div className="invoice-editor-actions">
        <button type="button" className="button-secondary" disabled={!!action || readingLogo || !dirty} onClick={() => void save("draft")}>
          {action === "draft" ? "Saving…" : "Save draft"}
        </button>
        <button type="button" className="invoice-publish" disabled={!!action || readingLogo || (!dirty && !saved.hasUnpublishedChanges)}
          onClick={() => void save("publish")}>{action === "publish" ? "Publishing…" : "Publish template"}</button>
      </div>
    </header>
    {error && <ErrorMessage key={error}>{error}</ErrorMessage>}
    {logoError && <ErrorMessage key={logoError.revision}>{logoError.message}</ErrorMessage>}
    <p className="invoice-editor-status" role="status">{status}</p>
    <div className="invoice-editor-layout">
      <section className="invoice-editor-controls" aria-labelledby="invoice-sections">
        <h2 id="invoice-sections">Sections</h2>
        <ul className="invoice-section-list">
          {template.order.map((section, index) => <li key={section}
            draggable={!action}
            data-drop-target={dropTarget === section || undefined}
            onDragStart={event => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", section);
              setDragging(section);
            }}
            onDragOver={event => {
              if (!dragging || dragging === section) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTarget(section);
            }}
            onDragEnd={() => { setDragging(null); setDropTarget(null); }}
            onDrop={event => {
              event.preventDefault();
              if (dragging && dragging !== section) reorder(dragging, index);
              setDragging(null);
              setDropTarget(null);
            }}>
            <button type="button" aria-pressed={selected === section} aria-controls="invoice-section-settings" onClick={() => setSelected(section)}>
              <Icon name="grip" size={17} />
              <span>{sectionNames[section]}</span>
              {selected === section && <Icon name="check" size={16} />}
              <Icon name="chevronRight" size={16} />
            </button>
          </li>)}
        </ul>
        <fieldset className="invoice-editor-settings" id="invoice-section-settings" disabled={!!action || readingLogo}>
          <legend>{sectionNames[selected]} settings</legend>
          <TemplateSectionSettings section={selected} template={template} update={update} logoControl={{
            reading: readingLogo,
            error: logoError?.message ?? "",
            replace: file => void replaceLogo(file),
            restore: restoreDefaultLogo,
          }} />
          <div className="invoice-editor-actions invoice-reorder">
            <button type="button" className="button-secondary" disabled={currentIndex === 0} onClick={() => reorder(selected, currentIndex - 1)}>
              <Icon name="up" size={17} /> Move up
            </button>
            <button type="button" className="button-secondary" disabled={currentIndex === template.order.length - 1} onClick={() => reorder(selected, currentIndex + 1)}>
              <Icon name="down" size={17} /> Move down
            </button>
          </div>
        </fieldset>
      </section>
      <section className="invoice-preview" aria-labelledby="invoice-preview-title">
        <header className="invoice-preview-toolbar">
          <h2 id="invoice-preview-title">PDF preview</h2>
          <Select aria-label="Invoice type" value={kind} onChange={event => setKind(event.target.value as InvoiceKind)}>
            <option value="booking">{invoiceKinds.booking}</option><option value="extras">{invoiceKinds.extras}</option>
          </Select>
          <Select aria-label="Preview zoom" value={zoom} onChange={event => setZoom(event.target.value)}>
            <option value="fit">Fit page</option><option value="actual">Actual size</option>
          </Select>
        </header>
        <div className="invoice-preview-canvas" data-zoom={zoom} aria-busy={previewPending}>
          {previewError && <div className="invoice-preview-error" role="alert">
            <span>{previewError}</span> <button type="button" onClick={() => setPreviewRetry(value => value + 1)}>Retry preview</button>
          </div>}
          {preview.map((page, index) => <img key={index} src={"data:image/png;base64," + page} alt={"Sample invoice PDF, page " + (index + 1)} />)}
          {!preview.length && !previewError && <p role="status">Preparing preview…</p>}
        </div>
      </section>
    </div>
  </main>;
}
