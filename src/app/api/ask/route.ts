/**
 * POST /api/ask  { ticker, question, fromYear, toYear }
 * Runs on the server only, so the secret Supabase key and the Anthropic and
 * Voyage keys never reach the browser. The logic is in lib/qa/ask.ts and the
 * real services in lib/qa/server-deps.ts; this file handles HTTP.
 */
import { createRateLimiter, handleAsk } from "@/lib/qa/ask";
import { createAskDepsFromEnv } from "@/lib/qa/server-deps";

/** A Sonnet answer takes ~5–15 s; leave room for a retry. */
export const maxDuration = 60;

/** 5 questions a minute per visitor address (kept in this server's memory, so rough by design). */
const allowVisitor = createRateLimiter(5, 60_000);

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const visitor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowVisitor(visitor, Date.now())) {
    return json(429, { error: "Too many questions in a minute. Wait a moment and try again." });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Send a JSON body." });
  }

  const built = createAskDepsFromEnv(process.env);
  if (!built.ok) {
    console.error(`ask: server is missing ${built.missing.join(", ")}`);
    return json(500, { error: "The server isn't configured for questions yet." });
  }

  try {
    const result = await handleAsk(body, built.deps);
    return result.ok ? json(200, result.response) : json(result.status, { error: result.error });
  } catch (error) {
    console.error("ask: unexpected error:", error instanceof Error ? error.message : error);
    return json(500, { error: "Something went wrong answering this question." });
  }
}
