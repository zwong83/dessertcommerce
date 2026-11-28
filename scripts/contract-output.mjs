import { readFile, writeFile } from "node:fs/promises";

export async function writeOrCheckContract(destination, generated, check) {
  if (!check) {
    await writeFile(destination, generated);
    return;
  }
  // Git may check out CRLF on Windows; only content drift should fail the check.
  const existing = await readFile(destination, "utf8");
  if (existing.replaceAll("\r\n", "\n") !== generated.replaceAll("\r\n", "\n")) {
    throw new Error("Regenerate the checked contract types with npm run contract:generate.");
  }
}
