import { describe, expect, it } from "vitest";
import {
  createSecClient,
  createSecClientFromEnv,
  parseRetryAfter,
  SecHttpError,
  SecRequestCapError,
  type SecClientOptions,
} from "@/lib/sec/client";
import { createFakeClock } from "../../../tests/fake-clock";

const UA = "Filing Analyst test@example.org";
const URL_A = "https://data.sec.gov/submissions/CIK0000104169.json";

interface Call {
  url: string;
  userAgent: string | null;
  at: number;
}

/**
 * A fake fetch that plays back a script of responses (or thrown errors)
 * and records every call, so tests never touch the real SEC.
 */
function fakeFetch(script: Array<Response | Error>, clock: { now(): number }) {
  const calls: Call[] = [];
  const fn: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      userAgent: new Headers(init?.headers).get("user-agent"),
      at: clock.now(),
    });
    const next = script.shift();
    if (next === undefined) throw new Error("fake fetch: no more scripted responses");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const status = (code: number, headers: Record<string, string> = {}) => new Response("error", { status: code, headers });

function setup(script: Array<Response | Error>, options: Partial<SecClientOptions> = {}) {
  const clock = createFakeClock();
  const fake = fakeFetch(script, clock);
  const client = createSecClient({ userAgent: UA, fetchFn: fake.fn, clock, ...options });
  return { client, clock, calls: fake.calls };
}

describe("createSecClient: basics", () => {
  it("sends the User-Agent and returns parsed JSON", async () => {
    const { client, calls } = setup([json({ name: "Walmart Inc." })]);
    await expect(client.getJson(URL_A)).resolves.toEqual({ name: "Walmart Inc." });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.userAgent).toBe(UA);
  });

  it("returns documents as text", async () => {
    const { client } = setup([new Response("<html>10-K</html>")]);
    await expect(client.getText("https://www.sec.gov/Archives/edgar/data/1/2/a.htm")).resolves.toBe("<html>10-K</html>");
  });

  it("refuses non-SEC URLs without sending anything", async () => {
    const { client, calls } = setup([]);
    await expect(client.getJson("https://example.com/x.json")).rejects.toThrow(/non-SEC URL/);
    expect(calls).toHaveLength(0);
  });

  it("spaces requests through the rate limiter (125 ms at 8/s)", async () => {
    const { client, calls } = setup([json(1), json(2), json(3)]);
    for (let i = 0; i < 3; i++) await client.getJson(URL_A);
    expect(calls.map((c) => c.at)).toEqual([0, 125, 250]);
  });
});

describe("createSecClient: retries", () => {
  it("retries a 429 and succeeds", async () => {
    const { client, calls, clock } = setup([status(429), json({ ok: true })]);
    await expect(client.getJson(URL_A)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(clock.sleeps).toContain(1000); // first backoff
  });

  it("backs off 1 s then 2 s on repeated 503s", async () => {
    const { client, calls, clock } = setup([status(503), status(503), json({ ok: true })]);
    await client.getJson(URL_A);
    expect(calls).toHaveLength(3);
    expect(clock.sleeps.filter((ms) => ms >= 1000)).toEqual([1000, 2000]);
  });

  it("waits as long as Retry-After asks when that's longer than the backoff", async () => {
    const { client, clock } = setup([status(429, { "retry-after": "5" }), json({})]);
    await client.getJson(URL_A);
    expect(clock.sleeps).toContain(5000);
  });

  it("caps any single wait at maxDelayMs", async () => {
    const { client, clock } = setup([status(429, { "retry-after": "3600" }), json({})], { maxDelayMs: 30_000 });
    await client.getJson(URL_A);
    expect(Math.max(...clock.sleeps)).toBe(30_000);
  });

  it("gives up after maxRetries and reports the last status", async () => {
    const { client, calls } = setup([status(500), status(500), status(500), status(500)]);
    const error = await client.getJson(URL_A).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SecHttpError);
    expect((error as SecHttpError).status).toBe(500);
    expect(calls).toHaveLength(4); // 1 attempt + 3 retries
  });

  it("does not retry a 404", async () => {
    const { client, calls } = setup([status(404)]);
    const error = await client.getJson(URL_A).catch((e: unknown) => e);
    expect((error as SecHttpError).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it("retries network errors, then succeeds", async () => {
    const { client, calls } = setup([new TypeError("fetch failed"), json({ ok: true })]);
    await expect(client.getJson(URL_A)).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it("reports a network error after the last retry, keeping the cause", async () => {
    const cause = new TypeError("fetch failed");
    const { client } = setup([cause, cause, cause, cause]);
    const error = await client.getJson(URL_A).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/Network error .* after 4 attempts/);
    expect((error as Error).cause).toBe(cause);
  });
});

describe("createSecClient: hard cap", () => {
  it("refuses requests beyond maxRequests", async () => {
    const { client, calls } = setup([json(1), json(2), json(3)], { maxRequests: 2 });
    await client.getJson(URL_A);
    await client.getJson(URL_A);
    await expect(client.getJson(URL_A)).rejects.toBeInstanceOf(SecRequestCapError);
    expect(calls).toHaveLength(2);
    expect(client.requestCount).toBe(2);
  });

  it("counts retries toward the cap", async () => {
    const { client, calls } = setup([status(503), status(503), json({})], { maxRequests: 2 });
    await expect(client.getJson(URL_A)).rejects.toBeInstanceOf(SecRequestCapError);
    expect(calls).toHaveLength(2);
  });
});

describe("createSecClient: settings", () => {
  it("won't go above 8 requests per second", () => {
    expect(() => createSecClient({ userAgent: UA, maxPerSecond: 10 })).toThrow(/can't exceed 8/);
  });

  it("requires a contact email in the User-Agent", () => {
    expect(() => createSecClient({ userAgent: "Filing Analyst" })).toThrow(/contact email/);
  });
});

describe("createSecClientFromEnv", () => {
  it("builds a client from a valid SEC_USER_AGENT", () => {
    expect(createSecClientFromEnv({ SEC_USER_AGENT: UA }).requestCount).toBe(0);
  });

  it("explains a missing or placeholder value without printing it", () => {
    expect(() => createSecClientFromEnv({})).toThrow(/SEC_USER_AGENT not set/);
    const placeholder = "Filing Analyst your-email@example.com";
    const error = (() => {
      try {
        createSecClientFromEnv({ SEC_USER_AGENT: placeholder });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error?.message).toMatch(/example email/);
    expect(error?.message).not.toContain(placeholder);
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds", () => expect(parseRetryAfter("5", 0)).toBe(5000));
  it("reads an HTTP date relative to now", () => {
    const now = Date.parse("2026-11-24T12:00:00Z");
    expect(parseRetryAfter("Tue, 24 Nov 2026 12:00:10 GMT", now)).toBe(10_000);
  });
  it.each([null, "", "soon"])("ignores %j", (value) => expect(parseRetryAfter(value, 0)).toBeUndefined());
});
