import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";
import test from "node:test";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".next" || entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

test("frontend uses HTTP contracts and cannot import backend, test or launcher code", () => {
  const frontend = resolve("frontend");
  for (const file of sourceFiles(frontend)) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\b(?:DATABASE_URL|SWEETCOMMERCE_(?:MIGRATION|WORKER)_DATABASE_URL)\b/, file);
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      let specifier: ts.Node | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        specifier = node.moduleSpecifier;
      } else if (ts.isCallExpression(node)
          && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(parsed) === "require")) {
        specifier = node.arguments[0];
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        specifier = node.moduleReference.expression;
      }
      if (specifier && ts.isStringLiteral(specifier)) {
        const dependency = specifier.text;
        assert.doesNotMatch(dependency, /^(?:pg|pg-native|pg-pool|postgres|embedded-postgres)(?:\/|$)/, file);
        if (dependency.startsWith(".") || dependency.startsWith("@/") || isAbsolute(dependency)) {
          const target = dependency.startsWith("@/")
            ? resolve(frontend, dependency.slice(2))
            : resolve(file, "..", dependency);
          const path = relative(frontend, target);
          assert.ok(!path.startsWith("..") && !isAbsolute(path), `${file} imports outside frontend: ${dependency}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
  }
});
