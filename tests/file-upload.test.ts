import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FileUpload } from "../frontend/ui/file-upload";
import { uploadFileSize, uploadSelectionIssue } from "../frontend/ui/file-upload-model";

const types = ["image/jpeg", "image/png", "image/webp"];
const maxBytes = 2 * 1024 * 1024;
const props = { id: "test-photo", label: "Product photo", accept: types, maxBytes, help: "Images up to 2 MiB" };

test("upload selection checks count, empty data, exact size limit and context-specific types", () => {
  const file = { type: "image/png", size: maxBytes };
  assert.equal(uploadSelectionIssue([file], types, maxBytes), null);
  assert.match(uploadSelectionIssue([], types, maxBytes)!, /one file/);
  assert.match(uploadSelectionIssue([file, file], types, maxBytes)!, /one file/);
  assert.match(uploadSelectionIssue([{ ...file, size: 0 }], types, maxBytes)!, /empty/);
  assert.match(uploadSelectionIssue([{ ...file, size: maxBytes + 1 }], types, maxBytes)!, /too large/);
  for (const type of ["image/svg+xml", "text/html", "", "application/pdf"]) {
    assert.match(uploadSelectionIssue([{ ...file, type }], types, maxBytes)!, /not supported/);
  }
  assert.equal(uploadSelectionIssue([{ ...file, type: "application/pdf" }], ["image/jpeg", "image/png", "application/pdf"], maxBytes), null);
});

test("uploads retain named required form inputs and a keyboard-operable file chooser", () => {
  const html = renderToStaticMarkup(createElement(FileUpload, { ...props, name: "proof", required: true }));
  assert.match(html, /<input(?=[^>]*name="proof")(?=[^>]*type="file")/);
  assert.match(html, /required=""/);
  assert.match(html, /aria-labelledby="test-photo-label"/);
  assert.match(html, /type="button"[^>]*class="button-secondary file-upload-choose"/);
  assert.match(html, /Choose file/);
  assert.match(html, /Drag &amp; drop/);
});

test("busy controls lock native selection and buttons and announce processing", () => {
  const html = renderToStaticMarkup(createElement(FileUpload, { ...props, busy: true, file: new File(["image"], "cake.png", { type: "image/png" }) }));
  assert.match(html, /type="file"[^>]*disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Remove selected file cake.png/);
  assert.match(html, /Processing your file/);
  assert.match(html, /Change file/);
});

test("PDF selections show a document summary without an embedded PDF or external preview", () => {
  const html = renderToStaticMarkup(createElement(FileUpload, { ...props, accept: ["application/pdf"], file: new File(["pdf"], "payment.pdf", { type: "application/pdf" }) }));
  assert.match(html, /payment.pdf/);
  assert.match(html, /PDF document/);
  assert.doesNotMatch(html, /<iframe|<object|<embed/);
  assert.equal(uploadFileSize(1024), "1 KB");
  assert.equal(uploadFileSize(maxBytes), "2.0 MiB");
});
