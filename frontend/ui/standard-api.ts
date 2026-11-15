import type { operations } from "../contracts/standard-v1";
import type { JsonInput, MutationResult, Problem, ReadResult } from "./standard-model";

const apiRoot = "/api/v1/";
const staleCodes = new Set<Problem["code"]>([
  "VERSION_CONFLICT", "REVIEW_STALE", "TERMS_CHANGED", "FEE_CHANGED", "DEADLINE_PASSED",
  "INVALID_TRANSITION", "CAPACITY_UNAVAILABLE", "PROOF_NOT_REVIEWABLE", "REFUND_LIMIT_EXCEEDED", "IDEMPOTENCY_CONFLICT",
]);

export class StandardProblem extends Error {
  constructor(readonly status: number, readonly problem: Problem | null) {
    super(problem?.message ?? "The ordering service could not confirm the result.");
  }
  get stale() { return this.problem !== null && staleCodes.has(this.problem.code); }
  get uncertain() { return this.status === 0 || this.status >= 500; }
  get denied() { return this.status === 401 || this.status === 403; }
}

export type Mutation = {
  path: string;
  method?: "POST" | "PUT";
  version?: number;
  json?: unknown;
  file?: File;
};
export type PreparedMutation = Readonly<{
  path: string;
  method: "POST" | "PUT";
  version?: number;
  body?: string | File;
  key: string;
}>;

export function prepareMutation(input: Mutation, key = crypto.randomUUID()): PreparedMutation {
  return {
    path: input.path,
    method: input.method ?? "POST",
    version: input.version,
    body: input.file ?? (input.json === undefined ? undefined : JSON.stringify(input.json)),
    key,
  };
}

async function request(path: string, init?: RequestInit) {
  if (!path || path.startsWith("/") || path.includes("\\")) throw new Error("Invalid ordering path.");
  let response: Response;
  try {
    response = await fetch(apiRoot + path, { ...init, cache: "no-store", credentials: "same-origin", redirect: "error" });
  } catch {
    throw new StandardProblem(0, null);
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as Problem | null;
    throw new StandardProblem(response.status, problem?.code ? problem : null);
  }
  return response;
}

async function responseJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new StandardProblem(0, null);
  }
}

export function readStandard<K extends keyof operations>(path: string, signal?: AbortSignal): Promise<ReadResult<K>> {
  return request(path, { signal }).then(responseJson<ReadResult<K>>);
}

export function sendStandard<T>(mutation: PreparedMutation, csrfToken: string): Promise<T> {
  const headers = new Headers({ "X-CSRF-Token": csrfToken, "Idempotency-Key": mutation.key });
  if (mutation.version !== undefined) headers.set("If-Match", '"' + mutation.version + '"');
  if (typeof mutation.body === "string") headers.set("Content-Type", "application/json");
  else if (mutation.body) {
    headers.set("Content-Type", "application/octet-stream");
    headers.set("X-File-Media-Type", mutation.body.type);
  }
  return request(mutation.path, { method: mutation.method, headers, body: mutation.body }).then(responseJson<T>);
}

export function previewInvoicePdf(path: string, template: unknown, csrfToken: string, signal: AbortSignal) {
  return request(path, {
    method: "POST", signal, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ template }),
  }).then(responseJson<{ pages: string[] }>);
}

export type JsonCommand<K extends keyof operations> = Omit<Mutation, "json" | "file"> & { json: JsonInput<K> };
export type CommandResult<K extends keyof operations> = MutationResult<K>;

// The relay serves private evidence as octet-stream, so use the validated file signature for its download name.
export function proofExtension(bytes: Uint8Array) {
  const matches = (header: number[]) => header.every((value, index) => bytes[index] === value);
  if (matches([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (matches([0xff, 0xd8, 0xff])) return "jpg";
  if (matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  return "bin";
}

export async function downloadProof(proofId: string) {
  const response = await request("admin/proofs/" + encodeURIComponent(proofId) + "/content");
  const body = await response.arrayBuffer();
  const url = URL.createObjectURL(new Blob([body], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "payment-proof." + proofExtension(new Uint8Array(body));
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
