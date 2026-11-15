export const sessionCookieName = "__Host-sc-session";

export function requestCookie(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(name + "="))?.slice(name.length + 1);
}
