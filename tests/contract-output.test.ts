import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { writeOrCheckContract } from "../scripts/contract-output.mjs";

test("contract checks accept LF and CRLF without rewriting files, but reject content drift", async t => {
  const cache = join(process.cwd(), ".cache");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "contract-output-"));
  const file = join(directory, "generated.ts");
  t.after(async () => { await unlink(file); await rmdir(directory); });
  const generated = "export type InvoiceKind = 'booking' | 'extras';\n";
  for (const text of [generated, generated.replaceAll("\n", "\r\n")]) {
    await writeFile(file, text);
    await writeOrCheckContract(file, generated, true);
    assert.equal(await readFile(file, "utf8"), text);
  }
  const stale = generated.replace("extras", "incorrect");
  await writeFile(file, stale);
  await assert.rejects(writeOrCheckContract(file, generated, true), /Regenerate/);
  assert.equal(await readFile(file, "utf8"), stale);
  await writeOrCheckContract(file, generated, false);
  assert.equal(await readFile(file, "utf8"), generated);
});
