import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readBackend, type BackendRead } from "./backend-client";
import { ApiProblem } from "./problem";
import { sessionCookieName } from "./request";

export async function requirePageSession(role: "CUSTOMER" | "ADMIN", destination?: "/events" | "/events/new" | "/profile") {
  const login = role === "ADMIN" ? "/merchant/login"
    : destination ? "/login?" + new URLSearchParams({ next: destination }) : "/login";
  if (!(await cookies()).get(sessionCookieName)?.value) redirect(login);
  try {
    const session = await readBackend<BackendRead<"getSession">>("session");
    if (session.role === role) return session;
  } catch (error) {
    if (!(error instanceof ApiProblem) || (error.status !== 401 && error.status !== 403)) throw error;
  }
  redirect(login);
}
