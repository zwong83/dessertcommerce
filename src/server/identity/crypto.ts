import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual,
} from "node:crypto";

export const otpPolicy = { ttlMs: 300_000, attempts: 5, sends: 3, windowMs: 900_000 } as const;

export function isEligibleChallenge(
  challenge: { expiresAt: Date; usedAt: Date | null; attempts: number },
  now: Date,
) {
  return !challenge.usedAt && challenge.expiresAt > now && challenge.attempts < otpPolicy.attempts;
}

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest();
}

export function equalHash(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function identityCrypto(secret: Buffer) {
  if (secret.length !== 32) throw new Error("Identity key must contain 32 bytes.");

  const sign = (purpose: string, input: string) => createHmac("sha256", secret)
    .update(purpose + "\0" + input)
    .digest();
  const otpVerifier = (id: string, code: string) => sign("otp", id + "\0" + code);
  const encryptionKey = sign("key", "destination-v1");

  return {
    destinationFingerprint: (destination: string) => sign("destination", destination),
    csrfToken: (session: string) => sign("csrf", session).toString("base64url"),
    otpVerifier,
    matchesOtp: (id: string, code: string, verifier: Buffer) => equalHash(otpVerifier(id, code), verifier),
    sealDestination(id: string, phone: string) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
      cipher.setAAD(Buffer.from(id));
      const data = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), data]);
    },
    openDestination(id: string, encoded: Buffer) {
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, encoded.subarray(0, 12));
      decipher.setAAD(Buffer.from(id));
      decipher.setAuthTag(encoded.subarray(12, 28));
      return Buffer.concat([decipher.update(encoded.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}
