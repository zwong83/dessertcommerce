import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

test("web routes cannot reach PostgreSQL or repository adapters directly", () => {
  for (const file of sourceFiles("src/app")) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /(?:from\s*|import\s*\(\s*)["'](?:pg["']|[^"']*(?:\/persistence|\/repositories)\b)/, file);
  }
});
