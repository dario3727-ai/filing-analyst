import { describe, expect, it } from "vitest";
import {
  createVoyageClient,
  createVoyageClientFromEnv,
  EMBEDDING_DIMENSIONS,
  parseEmbeddingResponse,
  VoyageHttpError,
  VoyageRequestCapError,
  VOYAGE_EMBEDDINGS_URL,
} from "./client.ts";
import { createFakeClock } from "../../../tests/fake-clock";

const vector = (fill: number) => new Array<number>(EMBEDDING_DIMENSIONS).fill(fill);

function ok(count: number, tokens = 10): Response {
  // Returned out of order on purpose: the client must sort by index.
  const data = Array.from({ length: count }, (_, i) => ({ object: "embedding", index: i, embedding: vector(i) })).reverse();
  return new Response(JSON.stringify({ object: "list", data, model: "voyage-4", usage: { total_tokens: tokens } }), {
    status: 200,
  });
}

function fakeFetch(script: Array<Response | Error>) {
  const calls: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  const fn: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      auth: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const next = script.shift();
    if (next === undefined) throw new Error("fake fetch: no more scripted responses");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, calls };
}

describe("Voyage client", () => {
  it("sends the model, input type and dimensions, and returns embeddings in input order", async () => {
    const f = fakeFetch([ok(3, 42)]);
    const client = createVoyageClient({ apiKey: "test-key", fetchFn: f.fn, clock: createFakeClock() });
    const result = await client.embed(["a", "b", "c"], "document");
    expect(result.embeddings.map((e) => e[0])).toEqual([0, 1, 2]);
    expect(result.tokens).toBe(42);
    expect(client.tokenCount).toBe(42);
    expect(f.calls[0]).toMatchObject({
      url: VOYAGE_EMBEDDINGS_URL,
      auth: "Bearer test-key",
      body: { input: ["a", "b", "c"], model: "voyage-4", input_type: "document", output_dimension: 1024, truncation: false },
    });
  });

  it("retries 429 and 5xx with backoff, honoring Retry-After", async () => {
    const clock = createFakeClock();
    const f = fakeFetch([
      new Response("slow down", { status: 429, headers: { "retry-after": "20" } }),
      new Response("oops", { status: 503 }),
      ok(1),
    ]);
    const client = createVoyageClient({ apiKey: "k", fetchFn: f.fn, clock });
    await client.embed(["a"], "query");
    expect(clock.sleeps).toEqual([20_000, 4000]);
    expect(client.requestCount).toBe(3);
  });

  it("fails at once on a non-retryable error, with Voyage's message", async () => {
    const f = fakeFetch([new Response('{"detail":"Provided API key is invalid."}', { status: 401 })]);
    const client = createVoyageClient({ apiKey: "k", fetchFn: f.fn, clock: createFakeClock() });
    const error = await client.embed(["a"], "query").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VoyageHttpError);
    expect(String(error)).toContain("401");
    expect(String(error)).toContain("invalid");
    expect(f.calls).toHaveLength(1);
  });

  it("gives up after maxRetries", async () => {
    const f = fakeFetch([new Response("", { status: 500 }), new Response("", { status: 500 })]);
    const client = createVoyageClient({ apiKey: "k", fetchFn: f.fn, clock: createFakeClock(), maxRetries: 1 });
    await expect(client.embed(["a"], "query")).rejects.toBeInstanceOf(VoyageHttpError);
    expect(f.calls).toHaveLength(2);
  });

  it("stops at the hard request cap", async () => {
    const f = fakeFetch([ok(1), ok(1)]);
    const client = createVoyageClient({ apiKey: "k", fetchFn: f.fn, clock: createFakeClock(), maxRequests: 1 });
    await client.embed(["a"], "query");
    await expect(client.embed(["b"], "query")).rejects.toBeInstanceOf(VoyageRequestCapError);
    expect(f.calls).toHaveLength(1);
  });

  it("refuses too many texts per request and skips empty requests", async () => {
    const f = fakeFetch([]);
    const client = createVoyageClient({ apiKey: "k", fetchFn: f.fn, clock: createFakeClock() });
    await expect(client.embed(new Array<string>(129).fill("x"), "document")).rejects.toThrow("At most 128");
    expect(await client.embed([], "document")).toEqual({ embeddings: [], tokens: 0 });
    expect(f.calls).toHaveLength(0);
  });
});

describe("parseEmbeddingResponse", () => {
  it("rejects a wrong count, a bad index or a wrong-length vector", () => {
    const one = (embedding: unknown, index: unknown = 0) => ({ data: [{ index, embedding }], usage: { total_tokens: 1 } });
    expect(() => parseEmbeddingResponse({ data: [] }, 1)).toThrow("0 embeddings for 1");
    expect(() => parseEmbeddingResponse(one(vector(0), 5), 1)).toThrow("bad or repeated index");
    expect(() => parseEmbeddingResponse(one([1, 2, 3]), 1)).toThrow("not 1024 numbers");
    expect(() => parseEmbeddingResponse(null, 1)).toThrow("not an object");
    expect(parseEmbeddingResponse(one(vector(0.5)), 1).embeddings[0]![0]).toBe(0.5);
  });
});

describe("createVoyageClientFromEnv", () => {
  it("returns null without a key", () => {
    expect(createVoyageClientFromEnv({})).toBeNull();
    expect(createVoyageClientFromEnv({ VOYAGE_API_KEY: "  " })).toBeNull();
    expect(createVoyageClientFromEnv({ VOYAGE_API_KEY: "k" })?.model).toBe("voyage-4");
  });
});
