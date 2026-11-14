import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { components } from "../../contracts/standard-v1";
import { type Queryable, withTransaction } from "../db";
import { ApiProblem } from "../http/problem";
import { equalHash, identityCrypto, isEligibleChallenge, otpPolicy, tokenHash } from "./crypto";

type Session = components["schemas"]["Session"];
type Challenge = components["schemas"]["Challenge"];
type Role = Session["role"];
type Purpose = "SIGN_IN" | "RECOVERY";

interface Enrollment {
  id: string;
  phone_e164: string | null;
  recovery_email: string | null;
  credential_epoch: string;
}

interface ChallengeRow {
  id: string;
  purpose: Purpose;
  enrollment_epoch: string | null;
  destination_fingerprint: Buffer;
  customer_destination_cipher: Buffer | null;
  verifier: Buffer;
  expires_at: Date;
  used_at: Date | null;
  attempts: number;
}

interface SessionRow {
  account_id: string;
  role: Role;
  csrf_hash: Buffer;
  expires_at: Date;
}

export interface OtpDelivery {
  deliver(input: { destination: string; code: string; role: Role; purpose: Purpose }): Promise<void>;
}

interface IdentityDependencies {
  pool: Pool;
  secret: Buffer;
  delivery: OtpDelivery;
  now?: () => Date;
  newCode?: () => string;
  sessionTtlMs: number;
  globalSendLimit: number;
}

const invalidOtp = () => new ApiProblem("OTP_INVALID", 422, "The code could not be verified. Request a new code and try again.");
const unauthenticated = () => new ApiProblem("UNAUTHENTICATED", 401, "Sign in to continue.");

export function createIdentity({
  pool, secret, delivery, now = () => new Date(), newCode = () => String(randomInt(1_000_000)).padStart(6, "0"),
  sessionTtlMs, globalSendLimit,
}: IdentityDependencies) {
  const crypto = identityCrypto(secret);

  async function admin(client: Queryable) {
    const result = await client.query<Enrollment>(
      "SELECT id, phone_e164, recovery_email, credential_epoch FROM account WHERE role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE",
    );
    return result.rows[0];
  }

  function enrolledContact(enrollment: Enrollment | undefined, contact: string) {
    if (!enrollment) return null;
    if (enrollment.phone_e164 === contact) return enrollment.phone_e164;
    if (enrollment.recovery_email?.toLowerCase() === contact) return enrollment.recovery_email;
    return null;
  }

  async function start(role: Role, destination: string, purpose: Purpose = "SIGN_IN"): Promise<Challenge> {
    const id = randomUUID();
    const code = newCode();
    const input = destination.trim().toLowerCase();
    const fingerprint = crypto.destinationFingerprint(input);

    const result = await withTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [41021, role === "ADMIN" ? 1 : 2]);
      const created = now();
      const expiry = new Date(created.getTime() + otpPolicy.ttlMs);
      const challenge = { challengeId: id, expiresAt: expiry.toISOString(), resendAt: new Date(created.getTime() + 60_000).toISOString() };
      const counts = await client.query<{ destination_count: string; global_count: string }>(
        "SELECT count(*) FILTER (WHERE destination_fingerprint = $1) AS destination_count, count(*) AS global_count " +
        "FROM otp_challenge WHERE role = $2 AND created_at > $3",
        [fingerprint, role, new Date(created.getTime() - otpPolicy.windowMs)],
      );
      const count = counts.rows[0];
      if (Number(count.destination_count) >= otpPolicy.sends || Number(count.global_count) >= globalSendLimit) {
        throw new ApiProblem("RATE_LIMITED", 429, "Try again later.", 900);
      }

      const enrollment = role === "ADMIN" ? await admin(client) : undefined;
      const contact = role === "ADMIN" ? enrolledContact(enrollment, input) : input;
      if (contact === null) return { challenge, contact };
      const sealed = role === "CUSTOMER" ? crypto.sealDestination(id, input) : null;
      await client.query(
        "INSERT INTO otp_challenge (id, role, purpose, enrollment_epoch, destination_fingerprint, verifier, customer_destination_cipher, created_at, expires_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [id, role, purpose, enrollment?.credential_epoch ?? null, fingerprint, crypto.otpVerifier(id, code), sealed, created, expiry],
      );
      return { challenge, contact };
    });

    if (result.contact !== null) {
      try {
        await delivery.deliver({ destination: result.contact, code, role, purpose });
      } catch {
        await pool.query(
          "UPDATE otp_challenge SET used_at = $2, customer_destination_cipher = NULL WHERE id = $1 AND used_at IS NULL",
          [id, now()],
        );
        throw new ApiProblem("DEPENDENCY_UNAVAILABLE", 503, "Verification is temporarily unavailable.");
      }
    }

    return result.challenge;
  }

  async function resolveCustomer(client: Queryable, phone: string) {
    await client.query(
      "INSERT INTO account (id, role, phone_e164) VALUES ($1,'CUSTOMER',$2) " +
      "ON CONFLICT (phone_e164) WHERE role = 'CUSTOMER' DO NOTHING",
      [randomUUID(), phone],
    );
    const result = await client.query<{ id: string }>(
      "SELECT id FROM account WHERE role = 'CUSTOMER' AND status = 'ACTIVE' AND phone_e164 = $1",
      [phone],
    );
    return result.rows[0]?.id;
  }

  async function verify(role: Role, id: string, code: string) {
    const token = randomBytes(32).toString("base64url");
    const csrf = crypto.csrfToken(token);

    const session = await withTransaction(pool, async (client): Promise<Session | null> => {
      // Recovery and verification take the enrollment lock before the challenge lock.
      const enrollment = role === "ADMIN" ? await admin(client) : undefined;
      const result = await client.query<ChallengeRow>(
        "SELECT id, purpose, enrollment_epoch, destination_fingerprint, verifier, customer_destination_cipher, expires_at, used_at, attempts " +
        "FROM otp_challenge WHERE id = $1 AND role = $2 FOR UPDATE",
        [id, role],
      );
      const row = result.rows[0];
      const current = now();
      if (!row || !isEligibleChallenge({ expiresAt: row.expires_at, usedAt: row.used_at, attempts: row.attempts }, current)) return null;

      if (role === "ADMIN") {
        const contacts = [enrollment?.phone_e164, enrollment?.recovery_email];
        const sameContact = contacts.some((contact) => contact
          && equalHash(row.destination_fingerprint, crypto.destinationFingerprint(contact.toLowerCase())));
        if (!enrollment || enrollment.credential_epoch !== row.enrollment_epoch || !sameContact) return null;
      }

      if (!crypto.matchesOtp(id, code, row.verifier)) {
        await client.query(
          "UPDATE otp_challenge SET attempts = attempts + 1, " +
          "used_at = CASE WHEN attempts + 1 >= $3 THEN $2 ELSE used_at END, " +
          "customer_destination_cipher = CASE WHEN attempts + 1 >= $3 THEN NULL ELSE customer_destination_cipher END WHERE id = $1",
          [id, current, otpPolicy.attempts],
        );
        return null;
      }

      let accountId = enrollment?.id;
      if (role === "CUSTOMER" && row.customer_destination_cipher) {
        accountId = await resolveCustomer(client, crypto.openDestination(id, row.customer_destination_cipher));
      }
      if (!accountId) return null;

      if (role === "ADMIN" && row.purpose === "RECOVERY") {
        await client.query("UPDATE account SET credential_epoch = credential_epoch + 1 WHERE id = $1", [accountId]);
        await client.query("UPDATE session SET revoked_at = $2 WHERE account_id = $1 AND revoked_at IS NULL", [accountId, current]);
      }
      await client.query("UPDATE otp_challenge SET used_at = $2, customer_destination_cipher = NULL WHERE id = $1", [id, current]);
      const expiry = new Date(current.getTime() + sessionTtlMs);
      await client.query(
        "INSERT INTO session (token_hash, account_id, csrf_hash, created_at, expires_at) VALUES ($1,$2,$3,$4,$5)",
        [tokenHash(token), accountId, tokenHash(csrf), current, expiry],
      );
      await client.query(
        "INSERT INTO audit_event (id, actor_id, feature, resource_id, action, occurred_at, request_id) VALUES ($1,$2,'identity',$2,$3,$4,$5)",
        [randomUUID(), accountId, row.purpose === "RECOVERY" ? "RECOVERY" : "SIGN_IN", current, id],
      );
      return { accountId, role, csrfToken: csrf, expiresAt: expiry.toISOString() };
    });

    if (!session) throw invalidOtp();
    return { token, session };
  }

  async function activeSession(token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthenticated();
    const result = await pool.query<SessionRow>(
      "SELECT s.account_id, a.role, s.csrf_hash, s.expires_at FROM session s JOIN account a ON a.id = s.account_id " +
      "WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND a.status = 'ACTIVE'",
      [tokenHash(token), now()],
    );
    const row = result.rows[0];
    if (!row) throw unauthenticated();
    return { row, token };
  }

  async function getSession(token: string | undefined, expectedRole?: Role, csrfToken?: string | null): Promise<Session> {
    const { row, token: sessionToken } = await activeSession(token);
    if (expectedRole && row.role !== expectedRole) {
      throw new ApiProblem("FORBIDDEN", 403, "This action requires a different account role.");
    }
    if (csrfToken !== undefined && (!csrfToken || !equalHash(tokenHash(csrfToken), row.csrf_hash))) {
      throw new ApiProblem("FORBIDDEN", 403, "Refresh your session and try again.");
    }
    return {
      accountId: row.account_id,
      role: row.role,
      csrfToken: crypto.csrfToken(sessionToken),
      expiresAt: row.expires_at.toISOString(),
    };
  }

  async function logout(token: string | undefined, csrfToken: string | null) {
    await getSession(token, undefined, csrfToken);
    if (!token) throw unauthenticated();
    await pool.query("UPDATE session SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL", [tokenHash(token), now()]);
  }

  return { start, verify, getSession, logout };
}

export type Identity = ReturnType<typeof createIdentity>;
