import { readFile, writeFile } from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";

const source = new URL("../output/SD/contracts/sweetcommerce-v1.0.4.openapi.json", import.meta.url);
const design = new URL("../openspec/changes/standard-dessert-ordering/design.md", import.meta.url);
const destination = new URL("../frontend/contracts/standard-v1.ts", import.meta.url);

const document = JSON.parse(await readFile(source, "utf8"));
const designText = await readFile(design, "utf8");
const scope = designText.split("## Contract operations and task ownership")[1]?.split(/^## /m)[0];
const namedIds = new Set(Array.from(scope?.matchAll(/`([A-Za-z]+)`/g) ?? [], (match) => match[1]));
const selected = new Set();

for (const [path, methods] of Object.entries(document.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!namedIds.has(operation.operationId)) {
      delete methods[method];
      continue;
    }
    selected.add(operation.operationId);
  }
  if (Object.keys(methods).length === 0) delete document.paths[path];
}

if (document.info.version !== "0.4.0" || selected.size !== 49) {
  throw new Error("The approved increment 1 contract scope has drifted.");
}

const result = "// Generated from the approved OpenAPI 0.4.0 increment 1 contract.\n"
  + astToString(await openapiTS(document));

if (process.argv.includes("--check")) {
  if (await readFile(destination, "utf8") !== result) {
    throw new Error("Regenerate the checked contract types with npm run contract:generate.");
  }
} else {
  await writeFile(destination, result);
}

const commercialSource = new URL("../output/SD/contracts/sweetcommerce-v1.0.4.1.openapi.json", import.meta.url);
const commercialDestination = new URL("../frontend/contracts/commercial-v1.ts", import.meta.url);
const commercial = JSON.parse(await readFile(commercialSource, "utf8"));
const commercialOperations = Object.values(commercial.paths).flatMap((entry) =>
  Object.values(entry).filter((operation) => typeof operation.operationId === "string"),
);
if (commercial.info.version !== "0.4.1" || commercialOperations.length !== 61) {
  throw new Error("The commercial v1 contract scope has drifted.");
}
const commercialTypes = "// Generated from the OpenAPI 0.4.1 commercial contract.\n"
  + astToString(await openapiTS(commercial));

if (process.argv.includes("--check")) {
  if (await readFile(commercialDestination, "utf8") !== commercialTypes) {
    throw new Error("Regenerate the checked contract types with npm run contract:generate.");
  }
} else {
  await writeFile(commercialDestination, commercialTypes);
}

const customerAuth = JSON.parse(await readFile(new URL("../output/SD/contracts/customer-auth-v1.openapi.json", import.meta.url), "utf8"));
const customerAuthDestination = new URL("../frontend/contracts/customer-auth-v1.ts", import.meta.url);
const customerAuthTypes = "// Generated from the customer authentication extension.\n" + astToString(await openapiTS(customerAuth));
if (process.argv.includes("--check")) {
  if (await readFile(customerAuthDestination, "utf8") !== customerAuthTypes) {
    throw new Error("Regenerate the checked contract types with npm run contract:generate.");
  }
} else {
  await writeFile(customerAuthDestination, customerAuthTypes);
}

const invoicesSource = new URL("../output/SD/contracts/event-invoices-v1.openapi.json", import.meta.url);
const invoicesDestination = new URL("../frontend/contracts/event-invoices-v1.ts", import.meta.url);
const invoiceTypes = "// Generated from the event invoice extension.\n"
  + astToString(await openapiTS(JSON.parse(await readFile(invoicesSource, "utf8"))));
if (process.argv.includes("--check")) {
  if (await readFile(invoicesDestination, "utf8") !== invoiceTypes) {
    throw new Error("Regenerate the checked contract types with npm run contract:generate.");
  }
} else {
  await writeFile(invoicesDestination, invoiceTypes);
}
