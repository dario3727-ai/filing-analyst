/**
 * Voyage AI embeddings client (decisions 2026-11-24). Plain fetch, no SDK.
 *  - POST https://api.voyageai.com/v1/embeddings with a Bearer key
 *  - retries with exponential backoff on 429 and 5xx (honoring Retry-After)
 *  - hard cap on requests per client, so a loop can never run away
 *  - checks the response shape: one embedding per input, right length, in order
 * fetch and the clock are injectable so tests never call the real API.
 */
import { systemClock, type Clock } from "../sec/rate-limiter.ts";
import { parseRetryAfter } from "../sec/client.ts";

export const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";
export const VOYAGE_MODEL = "voyage-4";
export const EMBEDDING_DIMENSIONS = 1024;
/** Voyage's per-request limit is 1,000 inputs; we stay far below it. */
export const MAX_INPUTS_PER_REQUEST = 128;

export type InputType = "document" | "query";

export interface VoyageClientOptions {
  apiKey: string;
  fetchFn?: typeof fetch;
  clock?: Clock;
  model?: string;
  /** Retries after the first attempt. Default 5. */
  maxRetries?: number;
  /** Wait before the first retry; doubles each time. Default 2000 ms. */
  baseDelayMs?: number;
  /** Longest single wait. Default 60 000 ms (rate limits are per minute). */
  maxDelayMs?: number;
  /** Hard cap on requests (including retries). Default 200. */
  maxRequests?: number;
}

export interface EmbedResult {
  embeddings: number[][];
  /** Tokens Voyage counted (what the free allowance is measured in). */
  tokens: number;
}

export interface VoyageClient {
  embed(texts: readonly string[], inputType: InputType): Promise<EmbedResult>;
  readonly model: string;
  readonly requestCount: number;
  readonly tokenCount: number;
}

export class VoyageHttpError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(`Voyage returned HTTP ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "VoyageHttpError";
    this.status = status;
  }
}

export class VoyageRequestCapError extends Error {
  constructor(maxRequests: number) {
    super(`Voyage request cap of ${maxRequests} reached; refusing to send more`);
    this.name = "VoyageRequestCapError";
  }
}

/** Checks the response body and returns embeddings in input order. */
export function parseEmbeddingResponse(body: unknown, expected: number): EmbedResult {
  if (typeof body !== "object" || body === null) throw new Error("Voyage response is not an object");
  const { data, usage } = body as { data?: unknown; usage?: unknown };
  if (!Array.isArray(data) || data.length !== expected) {
    throw new Error(`Voyage returned ${Array.isArray(data) ? data.length : "no"} embeddings for ${expected} inputs`);
  }
  const embeddings: number[][] = new Array<number[]>(expected);
  for (const item of data as unknown[]) {
    const { index, embedding } = (item ?? {}) as { index?: unknown; embedding?: unknown };
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= expected || embeddings[index]) {
      throw new Error(`Voyage returned a bad or repeated index: ${String(index)}`);
    }
    if (
      !Array.isArray(embedding) ||
      embedding.length !== EMBEDDING_DIMENSIONS ||
      !embedding.every((x) => typeof x === "number" && Number.isFinite(x))
    ) {
      throw new Error(`Voyage embedding ${index} is not ${EMBEDDING_DIMENSIONS} numbers`);
    }
    embeddings[index] = embedding as number[];
  }
  const total = (usage as { total_tokens?: unknown } | undefined)?.total_tokens;
  return { embeddings, tokens: typeof total === "number" ? total : 0 };
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export function createVoyageClient(options: VoyageClientOptions): VoyageClient {
  const apiKey = options.apiKey.trim();
  if (apiKey === "") throw new Error("Voyage API key is empty");
  const fetchFn = options.fetchFn ?? fetch;
  const clock = options.clock ?? systemClock;
  const model = options.model ?? VOYAGE_MODEL;
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 200;
  let requestCount = 0;
  let tokenCount = 0;

  async function embed(texts: readonly string[], inputType: InputType): Promise<EmbedResult> {
    if (texts.length === 0) return { embeddings: [], tokens: 0 };
    if (texts.length > MAX_INPUTS_PER_REQUEST) {
      throw new Error(`At most ${MAX_INPUTS_PER_REQUEST} texts per request, got ${texts.length}`);
    }
    const body = JSON.stringify({
      input: texts,
      model,
      input_type: inputType,
      output_dimension: EMBEDDING_DIMENSIONS,
      // Fail instead of silently cutting a passage that is too long.
      truncation: false,
    });

    for (let attempt = 0; ; attempt++) {
      if (requestCount >= maxRequests) throw new VoyageRequestCapError(maxRequests);
      requestCount++;
      let response: Response | undefined;
      let networkError: unknown;
      try {
        response = await fetchFn(VOYAGE_EMBEDDINGS_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body,
        });
      } catch (error) {
        networkError = error;
      }

      if (response?.ok) {
        const result = parseEmbeddingResponse((await response.json()) as unknown, texts.length);
        tokenCount += result.tokens;
        return result;
      }

      const retryable = response === undefined || isRetryable(response.status);
      if (!retryable || attempt >= maxRetries) {
        if (response) {
          // Voyage's error body explains the problem (e.g. invalid key); it never contains the key.
          const detail = (await response.text().catch(() => "")).slice(0, 300);
          throw new VoyageHttpError(response.status, detail);
        }
        throw new Error(`Network error calling Voyage after ${attempt + 1} attempts`, { cause: networkError });
      }
      await response?.body?.cancel().catch(() => undefined);
      const backoff = baseDelayMs * 2 ** attempt;
      const hinted = response ? parseRetryAfter(response.headers.get("retry-after"), clock.now()) : undefined;
      await clock.sleep(Math.min(Math.max(backoff, hinted ?? 0), maxDelayMs));
    }
  }

  return {
    embed,
    model,
    get requestCount() {
      return requestCount;
    },
    get tokenCount() {
      return tokenCount;
    },
  };
}

/** Builds the client from VOYAGE_API_KEY, or returns null when it isn't set. Never prints the key. */
export function createVoyageClientFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: Omit<VoyageClientOptions, "apiKey"> = {},
): VoyageClient | null {
  const apiKey = env.VOYAGE_API_KEY?.trim();
  if (!apiKey) return null;
  return createVoyageClient({ ...options, apiKey });
}
