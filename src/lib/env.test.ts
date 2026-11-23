import { describe, expect, it } from "vitest";
import { checkEnv, envIsReady, type Env } from "@/lib/env";

// Fake but correctly shaped values. None of these are real keys.
const GOOD: Env = {
  SEC_USER_AGENT: "Filing Analyst someone@example.org",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_FAKEpublishable123",
  SUPABASE_SECRET_KEY: "sb_secret_FAKEsecret456",
  ANTHROPIC_API_KEY: "sk-ant-FAKEanthropic789",
  VOYAGE_API_KEY: "pa-FAKEvoyage000",
};

function statusOf(env: Env, name: string) {
  return checkEnv(env).find((r) => r.name === name);
}

describe("checkEnv", () => {
  it("accepts a complete, well-formed environment", () => {
    const results = checkEnv(GOOD);
    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(envIsReady(results)).toBe(true);
  });

  it("reports missing and blank variables", () => {
    const env = { ...GOOD, ANTHROPIC_API_KEY: undefined, SUPABASE_SECRET_KEY: "   " };
    expect(statusOf(env, "ANTHROPIC_API_KEY")?.status).toBe("missing");
    expect(statusOf(env, "SUPABASE_SECRET_KEY")?.status).toBe("missing");
    expect(envIsReady(checkEnv(env))).toBe(false);
  });

  it("treats a missing Voyage key as not blocking (needed from milestone 3)", () => {
    const results = checkEnv({ ...GOOD, VOYAGE_API_KEY: undefined });
    expect(results.find((r) => r.name === "VOYAGE_API_KEY")?.status).toBe("missing");
    expect(envIsReady(results)).toBe(true);
  });

  it("rejects the example SEC email and a User-Agent without an email", () => {
    expect(statusOf({ ...GOOD, SEC_USER_AGENT: "Filing Analyst your-email@example.com" }, "SEC_USER_AGENT")?.problem)
      .toMatch(/example email/);
    expect(statusOf({ ...GOOD, SEC_USER_AGENT: "Filing Analyst" }, "SEC_USER_AGENT")?.problem)
      .toMatch(/contact email/);
    expect(statusOf({ ...GOOD, SEC_USER_AGENT: "someone@example.org" }, "SEC_USER_AGENT")?.problem)
      .toMatch(/app name/);
  });

  it("rejects a Supabase URL that isn't an https *.supabase.co address", () => {
    expect(statusOf({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: "not a url" }, "NEXT_PUBLIC_SUPABASE_URL")?.status).toBe("invalid");
    expect(statusOf({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: "http://x.supabase.co" }, "NEXT_PUBLIC_SUPABASE_URL")?.status).toBe("invalid");
    expect(statusOf({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: "https://example.com" }, "NEXT_PUBLIC_SUPABASE_URL")?.status).toBe("invalid");
  });

  it("catches the publishable and secret keys swapped", () => {
    const swapped = {
      ...GOOD,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: GOOD.SUPABASE_SECRET_KEY,
      SUPABASE_SECRET_KEY: GOOD.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    };
    expect(statusOf(swapped, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")?.status).toBe("invalid");
    expect(statusOf(swapped, "SUPABASE_SECRET_KEY")?.status).toBe("invalid");
  });

  it("accepts legacy JWT-style Supabase keys", () => {
    const legacy = { ...GOOD, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "eyJFAKE.anon", SUPABASE_SECRET_KEY: "eyJFAKE.service" };
    expect(envIsReady(checkEnv(legacy))).toBe(true);
  });

  it("flags any NEXT_PUBLIC_ variable holding a secret, whatever its name", () => {
    const env = { ...GOOD, NEXT_PUBLIC_DEBUG_KEY: GOOD.SUPABASE_SECRET_KEY, NEXT_PUBLIC_AI: "sk-ant-FAKE" };
    const results = checkEnv(env);
    expect(results.find((r) => r.name === "NEXT_PUBLIC_DEBUG_KEY")?.status).toBe("invalid");
    expect(results.find((r) => r.name === "NEXT_PUBLIC_AI")?.status).toBe("invalid");
    expect(envIsReady(results)).toBe(false);
  });

  it("never includes a variable's value in any message", () => {
    const bad = {
      SEC_USER_AGENT: "SECRETVALUE-no-email",
      NEXT_PUBLIC_SUPABASE_URL: "SECRETVALUE",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "SECRETVALUE",
      SUPABASE_SECRET_KEY: "SECRETVALUE",
      ANTHROPIC_API_KEY: "SECRETVALUE",
      NEXT_PUBLIC_LEAK: "sb_secret_SECRETVALUE",
    };
    const text = JSON.stringify(checkEnv(bad));
    expect(text).not.toContain("SECRETVALUE");
  });
});
