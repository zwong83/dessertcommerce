import Link from "next/link";
import { ErrorMessage } from "@/ui/error-message";

export default function NotFound() {
  return <main className="surface">
    <h1>Page not found</h1>
    <ErrorMessage>We couldn’t find that page. Check the address or return to the storefront.</ErrorMessage>
    <p><Link className="button" href="/">Back to Gather Dessert</Link></p>
  </main>;
}
