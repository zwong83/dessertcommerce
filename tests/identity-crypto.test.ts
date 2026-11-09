import assert from "node:assert/strict";
import test from "node:test";
import { identityCrypto, isEligibleChallenge } from "../src/server/identity/crypto";

const clock = new Date("2026-11-09T12:00:00Z");

test("challenge verification is bounded by expiry, consumption and attempt budget", () => {
  const challenge = { expiresAt: clock, usedAt: null, attempts: 4 };
  assert.equal(isEligibleChallenge(challenge, new Date(clock.getTime() - 1)), true);
  assert.equal(isEligibleChallenge(challenge, clock), false);
  assert.equal(isEligibleChallenge({ ...challenge, attempts: 5 }, new Date(clock.getTime() - 1)), false);
  assert.equal(isEligibleChallenge({ ...challenge, usedAt: clock }, new Date(clock.getTime() - 1)), false);
});

test("temporary customer destination is authenticated and challenge-bound", () => {
  const crypto = identityCrypto(Buffer.alloc(32, 9));
  const phone = "+60100001234";
  const ciphertext = crypto.sealDestination("challenge-a", phone);
  assert.equal(ciphertext.includes(phone), false);
  assert.equal(crypto.openDestination("challenge-a", ciphertext), phone);
  assert.throws(() => crypto.openDestination("challenge-b", ciphertext));
  assert.notDeepEqual(ciphertext, crypto.sealDestination("challenge-a", phone));
});

test("OTP and CSRF verification are scoped to distinct credentials", () => {
  const crypto = identityCrypto(Buffer.alloc(32, 9));
  const verifier = crypto.otpVerifier("challenge-a", "111111");
  assert.equal(crypto.matchesOtp("challenge-a", "111111", verifier), true);
  assert.equal(crypto.matchesOtp("challenge-a", "222222", verifier), false);
  assert.equal(crypto.matchesOtp("challenge-b", "111111", verifier), false);
  assert.notEqual(crypto.csrfToken("session-a"), crypto.csrfToken("session-b"));
});
