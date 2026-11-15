import type { operations } from "../../../frontend/contracts/standard-v1";
import { validation } from "../http/problem";
import {
  fieldString, fieldUuid, readObject, requestCookie, requireSameOrigin, sessionCookieName, setSessionCookie,
} from "../http/request";
import type { Identity } from "./service";

type Challenge = operations["startCustomerChallenge"]["responses"][201]["content"]["application/json"];
type Session = operations["getSession"]["responses"][200]["content"]["application/json"];

export function identityRoutes(identity: Identity, origin: string) {
  return async function handle(request: Request, path: string): Promise<Response | undefined> {
    const method = request.method;
    if (method === "GET" && path === "session") {
      const session: Session = await identity.getSession(requestCookie(request, sessionCookieName));
      return Response.json(session);
    }
    if (method !== "POST") return undefined;

    switch (path) {
      case "auth/otp/challenges": {
        requireSameOrigin(request, origin, 400);
        const body = await readObject(request, ["phone"]);
        const phone = fieldString(body.phone, "the international phone number", /^\+[1-9][0-9]{7,14}$/, 16);
        const challenge: Challenge = await identity.start("CUSTOMER", phone);
        return Response.json(challenge, { status: 201 });
      }
      case "admin/auth/challenges": {
        requireSameOrigin(request, origin, 400);
        const body = await readObject(request, ["verifiedContact", "purpose"]);
        const contact = fieldString(body.verifiedContact, "the enrolled contact");
        if (body.purpose !== undefined && body.purpose !== "SIGN_IN" && body.purpose !== "RECOVERY") {
          throw validation();
        }
        const challenge: Challenge = await identity.start("ADMIN", contact, body.purpose);
        return Response.json(challenge, { status: 201 });
      }
      case "auth/otp/verify":
      case "admin/auth/sign-in": {
        requireSameOrigin(request, origin, 400);
        const body = await readObject(request, ["challengeId", "code"]);
        const id = fieldUuid(body.challengeId, "the verification challenge");
        const code = fieldString(body.code, "the six-digit code", /^\d{6}$/, 6);
        const { token, session } = await identity.verify(path === "auth/otp/verify" ? "CUSTOMER" : "ADMIN", id, code);
        return Response.json(session, { headers: { "Set-Cookie": setSessionCookie(token, session.expiresAt) } });
      }
      case "session/logout": {
        requireSameOrigin(request, origin);
        await identity.logout(requestCookie(request, sessionCookieName), request.headers.get("x-csrf-token"));
        return new Response(null, { status: 204, headers: { "Set-Cookie": setSessionCookie("") } });
      }
      default:
        return undefined;
    }
  };
}
