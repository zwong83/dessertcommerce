import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FormValidationErrors } from "@/ui/form-validation-errors";
import "@daypicker/react/style.css";
import "./styles.css";
import "./controls-and-reports.css";
import "./product-editor.css";

export const metadata: Metadata = {
  title: "Gather Dessert",
  description: "Gather Dessert ordering and merchant workspace",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-MY">
      <body>
        <div id="site-error-messages" className="site-error-rail" />
        <FormValidationErrors />
        {children}
      </body>
    </html>
  );
}
