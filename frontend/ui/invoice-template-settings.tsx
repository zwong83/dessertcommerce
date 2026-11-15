import { Select } from "@/ui/select";
import { useRef, type ReactNode } from "react";
import { FileUpload } from "./file-upload";
import { invoiceLogoFormats, invoiceLogoMaxBytes, type InvoiceSection, type InvoiceTemplate } from "./invoice-model";

export type UpdateSection = <S extends InvoiceSection>(section: S, patch: Partial<InvoiceTemplate[S]>) => void;

function TextSetting({ children, value, max, onChange, multiline = false }: {
  children: ReactNode; value: string; max: number; onChange: (value: string) => void; multiline?: boolean;
}) {
  return <label className="invoice-setting">
    <span>{children}</span>
    {multiline
      ? <textarea value={value} maxLength={max} rows={3} onChange={event => onChange(event.target.value)} />
      : <input value={value} maxLength={max} onChange={event => onChange(event.target.value)} />}
  </label>;
}

type LogoControl = {
  reading: boolean;
  error: string;
  replace: (file: File) => void;
  restore: () => void;
};

function LogoSetting({ logo, reading, error, replace, restore }: LogoControl & {
  logo: InvoiceTemplate["header"]["logo"];
}) {
  const replaceButton = useRef<HTMLButtonElement>(null);
  const logoUrl = logo ? `data:${logo.mediaType};base64,${logo.data}` : "/gather-dessert-invoice-logo.webp";

  return <section className="invoice-logo-setting" aria-labelledby="invoice-logo-title">
    <div className="invoice-logo-overview">
      <div className="invoice-logo-preview">
        <img src={logoUrl} alt="Current invoice logo" width={64} height={64} />
      </div>
      <div>
        <h3 id="invoice-logo-title">Invoice logo</h3>
        <p className="invoice-logo-source" role="status">
          {reading ? "Loading logo…" : logo ? "Custom logo" : "Default Gather Dessert logo"}
        </p>
      </div>
    </div>
    <FileUpload resetKey={logo} id="invoice-logo-upload" label="Replace invoice logo"
      buttonRef={replaceButton} accept={invoiceLogoFormats} maxBytes={invoiceLogoMaxBytes}
      help="PNG, JPEG or WebP · Up to 2 MiB" hint="Updating your logo preview…" busy={reading}
      onFileChange={file => { if (file) replace(file); }} />
    {logo && <div className="invoice-logo-actions"><button className="button-quiet" type="button" disabled={reading} onClick={() => {
      restore();
      requestAnimationFrame(() => replaceButton.current?.focus());
    }}>Restore default</button></div>}
    <p className="invoice-logo-help" id="invoice-logo-help">Transparent images work best. Save your draft to keep changes.</p>
    {error && <p className="invoice-logo-error" id="invoice-logo-error">{error}</p>}
  </section>;
}

export function TemplateSectionSettings({ section, template, update, logoControl }: {
  section: InvoiceSection; template: InvoiceTemplate; update: UpdateSection; logoControl: LogoControl;
}) {
  switch (section) {
    case "header": {
      const { title, issuer, issuerDetails, accent, logo } = template.header;
      return <>
        <LogoSetting logo={logo} {...logoControl} />
        <label className="invoice-setting"><span>Accent color</span>
          <span className="invoice-color-field">
            <input type="color" aria-label="Accent color" value={accent}
              onChange={event => update("header", { accent: event.target.value.toUpperCase() })} />
            <span>{accent}</span>
          </span>
        </label>
        <TextSetting value={title} max={32} onChange={value => update("header", { title: value })}>Invoice title</TextSetting>
        <TextSetting value={issuer} max={90} onChange={value => update("header", { issuer: value })}>Business name</TextSetting>
        <TextSetting value={issuerDetails} max={280} multiline onChange={value => update("header", { issuerDetails: value })}>
          Registration, address and contact (optional)
        </TextSetting>
      </>;
    }
    case "billing":
      return <>
        <TextSetting value={template.billing.billedTo} max={42} onChange={value => update("billing", { billedTo: value })}>Billed-to heading</TextSetting>
        <TextSetting value={template.billing.venue} max={42} onChange={value => update("billing", { venue: value })}>Venue heading</TextSetting>
      </>;
    case "items":
      return <>
        <label className="invoice-setting"><span>Table style</span>
          <Select value={template.items.style}
            onChange={event => update("items", { style: event.target.value as InvoiceTemplate["items"]["style"] })}>
            <option value="tinted">Tinted header</option><option value="plain">Plain</option><option value="striped">Striped rows</option>
          </Select>
        </label>
        {([
          ["description", "Description column", 40],
          ["quantity", "Quantity column", 16],
          ["unitPrice", "Unit price column", 24],
          ["amount", "Amount column", 24],
        ] as const).map(([name, label, max]) => <TextSetting key={name} value={template.items[name]} max={max}
          onChange={value => update("items", { [name]: value })}>{label}</TextSetting>)}
      </>;
    case "payment":
      return <>
        <TextSetting value={template.payment.heading} max={48} onChange={value => update("payment", { heading: value })}>Payment heading</TextSetting>
        <TextSetting value={template.payment.instructions} max={480} multiline onChange={value => update("payment", { instructions: value })}>
          Additional DuitNow instructions (optional)
        </TextSetting>
      </>;
    case "footer":
      return <>
        <label className="invoice-setting invoice-checkbox"><input type="checkbox" checked={template.footer.visible}
          onChange={event => update("footer", { visible: event.target.checked })} /> Show notes and footer</label>
        <TextSetting value={template.footer.text} max={480} multiline onChange={value => update("footer", { text: value })}>
          Footer text (optional)
        </TextSetting>
      </>;
  }
}
