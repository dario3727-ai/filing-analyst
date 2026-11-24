/**
 * The one way this project talks to the SEC. Every request:
 *  1. must be an https URL on an SEC host (so the User-Agent, which contains
 *     a contact email, never goes anywhere else),
 *  2. counts toward a hard cap per client (no unbounded loops),
 *  3. waits for a rate-limiter slot (at most 8 per second; the SEC allows 10),
 *  4. sends the User-Agent the SEC requires.
 * On 429 (too many requests), 5xx (server error) or a network failure it
 * retries with growing waits (1 s, 2 s, 4 s...), honoring Retry-After.
 * Other errors, such as 404 Not Found, fail immediately.
 */
import { checkEnv, type Env } from "../env.ts";
import { createRateLimiter, systemClock, type Clock } from "./rate-limiter.ts";
import { isSecUrl } from "./urls.ts";

/** CLAUDE.md: stay under the SEC's limit of 10 requests per second. */
export const SEC_MAX_PER_SECOND = 8;

export interface SecClientOptions {
  /** App name plus contact email, e.g. "Filing Analyst you@example.com". */
  userAgent: string;
  /** Defaults to the global fetch. Tests pass a fake. */
  fetchFn?: typeof fetch;
  /** Defaults to the system clock. Tests pass a fake. */
  clock?: Clock;
  /** At most SEC_MAX_PER_SECOND. */
  maxPerSecond?: number;
  /** Retries after the first attempt. Default 3 (so up to 4 attempts). */
  maxRetries?: number;
  /** Wait before the first retry; doubles each time. Default 1000 ms. */
  baseDelayMs?: number;
  /** Longest single wait, including Retry-After. Default 30 000 ms. */
  maxDelayMs?: number;
  /** Hard cap on requests (including retries) for this client. Default 1000. */
  maxRequests?: number;
}

export interface SecClient {
  /** Fetches and parses JSON. The result is `unknown`: check its shape before use. */
  getJson(url: string): Promise<unknown>;
  /** Fetches a document as text, e.g. 10-K HTML. */
  getText(url: string): Promise<string>;
  /**
   * Fetches a document as raw bytes, exactly as the SEC sent them. Used for
   * filings we store: decoding is left to the parser, because older filings
   * aren't always UTF-8.
   */
  getBytes(url: string): Promise<Uint8Array>;
  /** Requests sent so far, including retries. */
  readonly requestCount: number;
}

/** The SEC answered, but with an error status. */
export class SecHttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string) {
    super(`SEC returned HTTP ${status} for ${url}`);
    this.name = "SecHttpError";
    this.status = status;
    this.url = url;
  }
}

/** The client's hard cap on requests was reached. */
export class SecRequestCapError extends Error {
  constructor(maxRequests: number) {
    super(`SEC request cap of ${maxRequests} reached; refusing to send more`);
    this.name = "SecRequestCapError";
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Retry-After is either seconds ("5") or an HTTP date. Returns ms to wait, if valid. */
export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (header === null || header.trim() === "") return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

export function createSecClient(options: SecClientOptions): SecClient {
  const userAgent = options.userAgent.trim();
  if (!/\S+@\S+\.\S+/.test(userAgent)) {
    throw new Error("SEC User-Agent must include a contact email");
  }
  const maxPerSecond = options.maxPerSecond ?? SEC_MAX_PER_SECOND;
  if (maxPerSecond > SEC_MAX_PER_SECOND) {
    throw new Error(`maxPerSecond can't exceed ${SEC_MAX_PER_SECOND}`);
  }
  const fetchFn = options.fetchFn ?? fetch;
  const clock = options.clock ?? systemClock;
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const maxRequests = options.maxRequests ?? 1000;
  const waitTurn = createRateLimiter(maxPerSecond, clock);
  let requestCount = 0;

  async function request(url: string): Promise<Response> {
    if (!isSecUrl(url)) {
      throw new Error(`Refusing to send a request to a non-SEC URL: ${url}`);
    }

    for (let attempt = 0; ; attempt++) {
      if (requestCount >= maxRequests) throw new SecRequestCapError(maxRequests);
      await waitTurn();
      requestCount++;

      let response: Response | undefined;
      let networkError: unknown;
      try {
        response = await fetchFn(url, { headers: { "User-Agent": userAgent } });
      } catch (error) {
        networkError = error; // DNS failure, connection reset, etc.
      }

      if (response?.ok) return response;

      const retryable = response === undefined || isRetryableStatus(response.status);
      if (!retryable || attempt >= maxRetries) {
        if (response) throw new SecHttpError(response.status, url);
        throw new Error(`Network error fetching ${url} after ${attempt + 1} attempts`, { cause: networkError });
      }

      // Free the connection before waiting; we don't need the error body.
      await response?.body?.cancel().catch(() => undefined);

      const backoff = baseDelayMs * 2 ** attempt;
      const hinted = response ? parseRetryAfter(response.headers.get("retry-after"), clock.now()) : undefined;
      await clock.sleep(Math.min(Math.max(backoff, hinted ?? 0), maxDelayMs));
    }
  }

  return {
    async getJson(url) {
      const response = await request(url);
      return (await response.json()) as unknown;
    },
    async getText(url) {
      const response = await request(url);
      return response.text();
    },
    async getBytes(url) {
      const response = await request(url);
      return new Uint8Array(await response.arrayBuffer());
    },
    get requestCount() {
      return requestCount;
    },
  };
}

/**
 * Builds a client using SEC_USER_AGENT from the environment (.env.local).
 * Throws a clear message if it's missing or still the example, without
 * printing its value.
 */
export function createSecClientFromEnv(
  env: Env = process.env,
  options: Omit<SecClientOptions, "userAgent"> = {},
): SecClient {
  const check = checkEnv(env).find((r) => r.name === "SEC_USER_AGENT");
  const userAgent = env.SEC_USER_AGENT;
  if (check?.status !== "ok" || userAgent === undefined) {
    throw new Error(`SEC_USER_AGENT ${check?.problem ?? "is not set"} (fix it in .env.local)`);
  }
  return createSecClient({ ...options, userAgent });
}
