import { cookies } from "next/headers";
import type { components, operations } from "@/contracts/standard-v1";
import { ApiProblem } from "./problem";
import { requestCookie, sessionCookieName } from "./request";

const requestHeaders = [
  "origin", "x-csrf-token", "idempotency-key", "if-match", "content-type", "x-file-media-type",
] as const;
const responseHeaders = [
  "cache-control", "content-disposition", "content-type", "retry-after", "x-content-type-options", "x-request-id",
] as const;

const unavailable = () => new ApiProblem("DEPENDENCY_UNAVAILABLE", 503, "The ordering service is temporarily unavailable.");

function backendUrl(path: string, query = "") {
  const origin = new URL(process.env.SWEETCOMMERCE_API_ORIGIN ?? "http://127.0.0.1:8000");
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
  ) throw unavailable();
  origin.pathname = "/api/v1/" + path;
  origin.search = query;
  return origin;
}

async function callBackend(path: string, query: string, init: RequestInit & { duplex?: "half" }) {
  try {
    return await fetch(backendUrl(path, query), {
      ...init, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw unavailable();
  }
}

export async function relayToBackend(request: Request, segments: string[]) {
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || /[/\\]/.test(segment))) {
    throw new ApiProblem("NOT_FOUND", 404, "This resource was not found.");
  }
  const headers = new Headers();
  for (const name of requestHeaders) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const session = requestCookie(request, sessionCookieName);
  if (session) headers.set("cookie", sessionCookieName + "=" + session);
  const upstream = await callBackend(segments.map(encodeURIComponent).join("/"), new URL(request.url).search, {
    method: request.method,
    headers,
    ...(request.body ? { body: request.body, duplex: "half" } : {}),
  });

  const forwarded = new Headers();
  for (const name of responseHeaders) {
    const value = upstream.headers.get(name);
    if (value !== null) forwarded.set(name, value);
  }
  for (const value of upstream.headers.getSetCookie()) forwarded.append("set-cookie", value);
  return new Response(upstream.body, { status: upstream.status, headers: forwarded });
}

export async function readBackend<T>(path: string, query = ""): Promise<T> {
  const session = (await cookies()).get(sessionCookieName)?.value;
  const headers = session ? { cookie: sessionCookieName + "=" + session } : undefined;
  const response = await callBackend(path, query, { headers });
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as components["schemas"]["Problem"] | null;
    if (!problem?.code) throw unavailable();
    throw new ApiProblem(problem.code, response.status, problem.message);
  }
  return await response.json() as T;
}

type ReadOperation = "getSession" | "getCart" | "listCatalog" | "getOwnOrder";
export type BackendRead<Operation extends ReadOperation> =
  operations[Operation]["responses"][200]["content"]["application/json"];
