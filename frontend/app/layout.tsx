import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { FormValidationErrors } from "@/ui/form-validation-errors";
import { PwaRegistration } from "@/ui/pwa-registration";
import "@daypicker/react/style.css";
import "./styles.css";
import "./controls-and-reports.css";
import "./product-editor.css";
import "./file-upload.css";

export const metadata: Metadata = {
  title: "Gather Dessert",
  description: "Gather Dessert ordering and merchant workspace",
  applicationName: "Gather Dessert",
  appleWebApp: { capable: true, title: "Gather Dessert", statusBarStyle: "default" },
  icons: { apple: "/pwa/apple-touch-icon.png", icon: "/pwa/icon-192.png" },
};

export const viewport: Viewport = { themeColor: "#fff6d6" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-MY">
      <body>
        <div id="site-error-messages" className="site-error-rail" />
        <FormValidationErrors />
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
