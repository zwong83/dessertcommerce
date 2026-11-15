import type { components } from "../../../frontend/contracts/standard-v1";

type Problem = components["schemas"]["Problem"];
type ProblemCode = Problem["code"];

export class ApiProblem extends Error {
  constructor(
    readonly code: ProblemCode,
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export function problemResponse(error: unknown, requestId: string) {
  const problem = error instanceof ApiProblem
    ? error
    : new ApiProblem("INTERNAL", 500, "Something went wrong.");
  const body: Problem = {
    code: problem.code,
    message: problem.message,
    requestId,
    retryable: problem.status === 429 || problem.status === 503,
  };
  if ("fieldErrors" in problem && Array.isArray(problem.fieldErrors)) {
    body.fieldErrors = problem.fieldErrors;
  }
  const headers = new Headers({ "Cache-Control": "no-store", "X-Request-Id": requestId });
  if (problem.retryAfter !== undefined) {
    headers.set("Retry-After", String(problem.retryAfter));
  }
  return Response.json(body, { status: problem.status, headers });
}

export function validation(message = "Check the submitted information.") {
  return new ApiProblem("VALIDATION", 422, message);
}
