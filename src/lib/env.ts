/**
 * Checks that the environment variables the app needs are present and look
 * right, WITHOUT ever putting a value in a message, so the report is safe to
 * print, paste or log.
 *
 * Pure function: give it any set of variables (process.env or a test object)
 * and it returns a report. Reading .env.local and printing happen elsewhere.
 */

export type EnvStatus = "ok" | "missing" | "invalid";

export interface EnvCheck {
  name: string;
  status: EnvStatus;
  required: boolean;
  /** Why it's missing or invalid. Never contains the value itself. */
  problem?: string;
}

/** Like process.env: names mapped to string values, some possibly undefined. */
export type Env = Readonly<Record<string, string | undefined>>;

interface EnvRule {
  name: string;
  required: boolean;
  /** Returns a problem description, or undefined if the value looks fine. */
  validate?: (value: string) => string | undefined;
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PLACEHOLDER_EMAIL = "your-email@example.com";
// Legacy Supabase keys (anon / service_role) are JWTs, which start with "eyJ".
const LEGACY_JWT = /^eyJ/;

export const ENV_RULES: readonly EnvRule[] = [
  {
    name: "SEC_USER_AGENT",
    required: true,
    validate: (value) => {
      if (value.includes(PLACEHOLDER_EMAIL)) return "still has the example email";
      const email = EMAIL.exec(value);
      if (!email) return "must include a contact email";
      if (value.replace(email[0], "").trim() === "") return "must include an app name before the email";
      return undefined;
    },
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    required: true,
    validate: (value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return "is not a valid URL";
      }
      if (url.protocol !== "https:") return "must start with https://";
      if (!url.hostname.endsWith(".supabase.co")) return "must be a *.supabase.co project URL";
      return undefined;
    },
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    required: true,
    validate: (value) => {
      if (value.startsWith("sb_secret_")) return "is a SECRET key; use the publishable key here";
      if (!value.startsWith("sb_publishable_") && !LEGACY_JWT.test(value)) {
        return "should start with sb_publishable_";
      }
      return undefined;
    },
  },
  {
    name: "SUPABASE_SECRET_KEY",
    required: true,
    validate: (value) => {
      if (value.startsWith("sb_publishable_")) return "is the publishable key; use the secret key here";
      if (!value.startsWith("sb_secret_") && !LEGACY_JWT.test(value)) {
        return "should start with sb_secret_";
      }
      return undefined;
    },
  },
  {
    name: "ANTHROPIC_API_KEY",
    required: true,
    validate: (value) => (value.startsWith("sk-ant-") ? undefined : "should start with sk-ant-"),
  },
  // Not needed until milestone 3 (embeddings), so missing is only a warning.
  { name: "VOYAGE_API_KEY", required: false },
];

/** Values that must never appear in a NEXT_PUBLIC_ variable (sent to browsers). */
function looksSecret(value: string): boolean {
  return value.startsWith("sb_secret_") || value.startsWith("sk-ant-");
}

export function checkEnv(env: Env): EnvCheck[] {
  const results: EnvCheck[] = ENV_RULES.map((rule) => {
    const value = env[rule.name]?.trim();
    if (!value) {
      return { name: rule.name, status: "missing", required: rule.required, problem: "not set" };
    }
    const problem = rule.validate?.(value);
    return problem
      ? { name: rule.name, status: "invalid", required: rule.required, problem }
      : { name: rule.name, status: "ok", required: rule.required };
  });

  // Anything prefixed NEXT_PUBLIC_ is bundled into browser code, so a secret
  // there would be visible to every visitor. Flag it, whatever its name.
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  for (const [name, raw] of Object.entries(env)) {
    const value = raw?.trim();
    if (!name.startsWith("NEXT_PUBLIC_") || !value) continue;
    if (looksSecret(value) || (secret !== undefined && secret !== "" && value === secret)) {
      const existing = results.find((r) => r.name === name);
      const problem = "contains a secret key, which NEXT_PUBLIC_ would expose to browsers";
      if (existing) {
        existing.status = "invalid";
        existing.problem = problem;
      } else {
        results.push({ name, status: "invalid", required: true, problem });
      }
    }
  }

  return results;
}

/** True when every required variable is ok (optional ones may be missing). */
export function envIsReady(results: readonly EnvCheck[]): boolean {
  return results.every((r) => r.status === "ok" || (!r.required && r.status === "missing"));
}
