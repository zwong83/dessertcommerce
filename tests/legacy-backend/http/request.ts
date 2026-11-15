import { ApiProblem, validation } from "./problem";

export const sessionCookieName = "__Host-sc-session";
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function requestCookie(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(name + "="))?.slice(name.length + 1);
}

export function setSessionCookie(token: string, expiry?: string) {
  const lifetime = expiry ? "; Expires=" + new Date(expiry).toUTCString() : "; Max-Age=0";
  return sessionCookieName + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Lax" + lifetime;
}

export function requireSameOrigin(request: Request, origin: string, status: 400 | 403 = 403) {
  if (request.headers.get("origin") !== origin) {
    throw new ApiProblem("ORIGIN_DENIED", status, "Send the request from this application.");
  }
}

export async function readObject(request: Request, allowed: readonly string[], limit = 32_768) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw validation("Submit a JSON request.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw validation("Submit a JSON request.");

  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApiProblem("VALIDATION", 422, "The submitted request is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiProblem("VALIDATION", 400, "Submit a valid JSON request.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw validation();
  }
  return value as Record<string, unknown>;
}

export function fieldString(value: unknown, label: string, pattern?: RegExp, max = 254) {
  if (typeof value !== "string" || !value.trim() || value.length > max || (pattern && !pattern.test(value))) {
    throw validation("Check " + label + ".");
  }
  return value;
}

export function fieldUuid(value: unknown, label: string) {
  return fieldString(value, label, uuidPattern, 36);
}
