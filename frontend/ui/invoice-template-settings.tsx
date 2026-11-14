import type { ReactNode } from "react";
import type { InvoiceSection, InvoiceTemplate } from "./invoice-model";

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

export function TemplateSectionSettings({ section, template, update, onLogo }: {
  section: InvoiceSection; template: InvoiceTemplate; update: UpdateSection; onLogo: (file: File) => void;
}) {
  switch (section) {
    case "header": {
      const { title, issuer, issuerDetails, accent, logo } = template.header;
      const logoUrl = logo ? "data:" + logo.mediaType + ";base64," + logo.data : "/gather-dessert-invoice-logo.webp";
      return <>
        <div className="invoice-logo-setting">
          <span>Logo</span>
          <img src={logoUrl} alt="" width={48} height={48} />
          <label className="button button-quiet invoice-upload">Replace logo
            <input type="file" aria-label="Replace logo" accept="image/png,image/jpeg,image/webp"
              onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) onLogo(file);
              }} />
          </label>
          {logo && <button type="button" onClick={() => update("header", { logo: null })}>Use default</button>}
        </div>
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
          <select value={template.items.style}
            onChange={event => update("items", { style: event.target.value as InvoiceTemplate["items"]["style"] })}>
            <option value="tinted">Tinted header</option><option value="plain">Plain</option><option value="striped">Striped rows</option>
          </select>
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
