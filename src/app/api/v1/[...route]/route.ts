import { randomUUID } from "node:crypto";
import { relayToBackend } from "@/server/http/backend-client";
import { problemResponse } from "@/server/http/problem";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ route: string[] }> };

async function dispatch(request: Request, context: RouteContext) {
  try {
    const { route } = await context.params;
    return await relayToBackend(request, route);
  } catch (error) {
    const response = problemResponse(error, randomUUID());
    response.headers.set("Content-Type", "application/problem+json");
    return response;
  }
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
