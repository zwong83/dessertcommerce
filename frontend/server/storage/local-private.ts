import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export function localPrivateStore(root: string, secret: Buffer) {
  const directory = resolve(root);
  async function path(key: string) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (await realpath(directory) !== directory) throw new Error("Invalid private storage root.");
    return join(directory, createHash("sha256").update(key).digest("hex"));
  }

  return {
    async put(key: string, bytes: Uint8Array) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", secret, nonce);
      cipher.setAAD(Buffer.from(key));
      const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
      await writeFile(await path(key), Buffer.concat([nonce, cipher.getAuthTag(), encrypted]), { flag: "wx", mode: 0o600 });
    },
    async get(key: string) {
      const file = await path(key);
      let bytes: Buffer;
      try {
        bytes = await readFile(file);
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
      const cipher = createDecipheriv("aes-256-gcm", secret, bytes.subarray(0, 12));
      cipher.setAAD(Buffer.from(key));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
    },
  };
}
