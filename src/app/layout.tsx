import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: "Gather Dessert",
  description: "Gather Dessert ordering and merchant workspace",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-MY">
      <body>{children}</body>
    </html>
  );
}
