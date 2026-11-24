# TypeScript primer

A short guide to the TypeScript you'll read and write in this project, using code that's already in the repo. You know JavaScript from n8n code nodes; TypeScript is that same JavaScript plus **types**: labels saying what kind of value each thing is, checked before the code runs.

Covered: types · interfaces · functions · async/await · modules · reading errors · exercises.

---

## 1. What TypeScript adds

```ts
// JavaScript: nothing stops this until it crashes at runtime
function padCik(cik) { return cik.padStart(10, "0"); }
padCik(104169);            // 💥 TypeError: cik.padStart is not a function (numbers don't have padStart)

// TypeScript: the type says what's allowed, and the mistake shows up in your editor
function padCik(cik: string): string { return cik.padStart(10, "0"); }
padCik(104169);            // ❌ Argument of type 'number' is not assignable to parameter of type 'string'.
```

Three things to know:
- **Types are checked, then erased.** `npm run typecheck` (and CI) check them; when the code runs, the types are gone and it's plain JavaScript. Types cost nothing at runtime and protect nothing at runtime: data from outside (SEC JSON, `.env.local`) still has to be checked in code, as `checkEnv` does.
- **Strict mode** (`"strict": true` in `tsconfig.json`) turns on the useful checks, especially "this might be `null` or `undefined`, handle it."
- **`noUncheckedIndexedAccess`**, which we added, makes looking something up by key or index possibly `undefined`. Exactly right for XBRL data, where a tag may simply not exist.

## 2. Types

### Basic types and inference
```ts
const ticker: string = "WMT";
const fiscalYear: number = 2025;
const isRetail: boolean = true;

const revenue = 1_250_000_000;     // made-up value; no label needed: TypeScript infers `number`
```
Write types on function parameters and exported things; let TypeScript infer the rest.

### Union types: "one of these"
From [src/lib/sec/cik.ts](../src/lib/sec/cik.ts):
```ts
export function padCik(cik: string | number): string {
  const text = String(cik).trim();
  ...
}
```
`string | number` means "a string or a number." The SEC returns CIKs as numbers in some places and strings in others, so the function accepts both and converts.

### Literal types: a fixed list of allowed values
From [src/lib/env.ts](../src/lib/env.ts):
```ts
export type EnvStatus = "ok" | "missing" | "invalid";
```
A variable of type `EnvStatus` can only hold one of those three strings. A typo like `"mising"` is a compile error. In n8n terms, it's a dropdown field rather than a free-text box. We'll use this for things like `"applicable" | "not_applicable"` on ratios.

### `undefined` and optional values
```ts
const env: Record<string, string | undefined> = process.env;
const key = env["ANTHROPIC_API_KEY"];   // type: string | undefined

key.startsWith("sk-ant-");               // ❌ 'key' is possibly 'undefined'.
key?.startsWith("sk-ant-");              // ✅ ?. stops and returns undefined if key is undefined
if (key) key.startsWith("sk-ant-");      // ✅ inside the if, TypeScript knows key is a string
const name = key ?? "(none)";            // ✅ ?? gives a fallback when the left side is null/undefined
```
That "inside the `if`, TypeScript knows more" behavior is called **narrowing**. You'll see it everywhere, for example in `checkEnv`:
```ts
const value = env[rule.name]?.trim();
if (!value) {
  return { name: rule.name, status: "missing", ... };   // handles undefined and ""
}
const problem = rule.validate?.(value);                 // here, value is definitely a string
```
This is the project's "missing data never crashes and never guesses" rule, enforced by the compiler.

### Arrays and objects
```ts
const tickers: string[] = ["WMT", "TGT", "COST"];
const first = tickers[0];                 // string | undefined (because of noUncheckedIndexedAccess)

const env: Record<string, string | undefined> = {};   // an object with any string keys
```
`readonly string[]` (or `readonly EnvRule[]`) means "you can read this array but not push to or change it": used for config like `ENV_RULES` that should never be modified while running.

## 3. Interfaces and type aliases

An **interface** describes the shape of an object: which fields it has and their types. From [src/lib/env.ts](../src/lib/env.ts):
```ts
export interface EnvCheck {
  name: string;
  status: EnvStatus;
  required: boolean;
  /** Why it's missing or invalid. Never contains the value itself. */
  problem?: string;          // ? = optional: may be absent
}
```
Think of it as the output schema of an n8n node: every item that comes out has these fields. If code forgets `required` or misspells `status`, the type check fails.

Fields can be functions too:
```ts
interface EnvRule {
  name: string;
  required: boolean;
  validate?: (value: string) => string | undefined;   // optional function: takes a string, returns a problem or nothing
}
```

A **type alias** (`type X = ...`) names any type, not only object shapes:
```ts
export type EnvStatus = "ok" | "missing" | "invalid";
export type Env = Readonly<Record<string, string | undefined>>;
```

**Rule of thumb for this project:** `interface` for object shapes (rows, results, config entries), `type` for unions and everything else. Both work; consistency matters more than the choice.

We'll write interfaces for each database table (`Company`, `Filing`, `FinancialFact`) so the compiler knows what a row looks like.

## 4. Functions

```ts
// Named function with typed parameters and return type
export function envIsReady(results: readonly EnvCheck[]): boolean {
  return results.every((r) => r.status === "ok" || (!r.required && r.status === "missing"));
}

// Arrow function, the short form; often used inline
const isOk = (r: EnvCheck): boolean => r.status === "ok";
```
- **Pure functions** (same input → same output, no side effects like reading files or calling APIs) are how we write ratios, red-flag rules and parsers. They're easy to test: `checkEnv` takes an object and returns a report, so its tests just pass in fake objects.
- When a function finds bad input it can't handle, it **throws**: `padCik("abc")` throws `Invalid CIK`. For *expected* gaps in data (a missing XBRL tag), we return a value like `"not_applicable"` instead of throwing.

## 5. async/await

Some operations take time: an HTTP request, a database query, reading a file. JavaScript doesn't stop and wait; the function returns a **Promise**, a placeholder for a value that arrives later. `await` pauses *this* function until the value arrives.

In n8n, every node automatically waits for the previous one. In code, you write `await` to get the same effect.

A sketch of what the SEC client will look like in milestone 1 (not in the repo yet):
```ts
interface Submissions {
  cik: string;
  name: string;
  tickers: string[];
}

// `async` makes the function return a Promise; the declared type is Promise<Submissions>
export async function fetchSubmissions(cik: string | number): Promise<Submissions> {
  const url = `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;

  // fetch() is the HTTP Request node. await = wait for the response.
  const response = await fetch(url, {
    headers: { "User-Agent": process.env.SEC_USER_AGENT ?? "" },
  });

  if (!response.ok) {
    throw new Error(`SEC returned ${response.status} for ${url}`);
  }

  // Parsing the body takes time too, so it's also awaited.
  // The result is `unknown` until we check it: types don't validate outside data.
  const data: unknown = await response.json();
  return parseSubmissions(data);   // checks the shape, throws if it's wrong
}

// Using it: errors from inside surface here, at the await
try {
  const walmart = await fetchSubmissions(104169);
  console.log(walmart.name);
} catch (error) {
  console.error("Could not load submissions:", error);
}
```
Things to notice:
- **Forgetting `await`** is the classic bug: `const r = fetch(url)` gives you a Promise, not a response. TypeScript usually catches it (`Property 'ok' does not exist on type 'Promise<Response>'`).
- **`unknown` vs `any`:** `unknown` means "could be anything, check it before use"; `any` turns type checking off. The project rule is no `any` without a written reason.
- **One at a time vs all at once:** `for` + `await` runs requests one after another; `Promise.all([...])` runs them together. The SEC allows 10 requests per second (we cap at 8), so the client will control how many run at once rather than firing everything.

## 6. Modules: import and export

Each file is a **module**. Anything not exported stays private to the file.
```ts
// src/lib/env.ts
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;        // private: only this file sees it
export function checkEnv(env: Env): EnvCheck[] { ... }   // public
export type EnvStatus = "ok" | "missing" | "invalid";
```
```ts
// src/lib/env.test.ts: import with the "@/" shortcut (means src/)
import { checkEnv, envIsReady, type Env } from "@/lib/env";

// scripts/check-env.ts: run directly by Node, so a relative path ending in .ts
import { checkEnv, envIsReady } from "../src/lib/env.ts";
```
- **Named exports** (`export function checkEnv`) are imported by name in braces. We use these almost everywhere.
- **Default exports** (`export default function Page()`) are imported without braces. Next.js requires them for pages and layouts (`src/app/page.tsx`).
- **`type Env`** in an import says "this is only a type"; it's erased when the code runs.
- **Why two import styles?** `@/...` is configured in `tsconfig.json` and `vitest.config.mts`, which Next.js and Vitest understand. Plain Node (running `scripts/`) doesn't know the alias, so scripts use relative paths with the `.ts` extension.
- **`"type": "module"`** in `package.json` tells Node these files use `import`/`export` (ES modules) rather than the older `require()` style you may have seen in n8n.

## 7. Reading a type error

```
src/lib/ratios.ts:12:20 - error TS18048: 'revenue' is possibly 'undefined'.
```
- `src/lib/ratios.ts:12:20`: file, line 12, column 20.
- `TS18048`: the error code; search it if the message is unclear.
- The message: what TypeScript can't prove is safe.

Fix the *cause* (handle the `undefined` case) rather than silencing it. Avoid `revenue!` (the `!` means "trust me, it's not undefined") and `as any`; they hide exactly the bugs strict mode is there to catch.

## 8. Exercises

Try each in your head or in a scratch file, then check the answer.

**1.** What's the type of `last`, and why?
```ts
const years: number[] = [2023, 2024, 2025];
const last = years[years.length - 1];
```
<details><summary>Answer</summary>

`number | undefined`. With `noUncheckedIndexedAccess`, any index lookup might miss (here, if the array were empty). Handle it with `if (last === undefined) ...` or `?? `.
</details>

**2.** Write an interface `Ratio` with a `name` (text), a `fiscalYear` (number), a `status` that is either `"applicable"` or `"not_applicable"`, an optional `value` (number) and an optional `reason` (text).

<details><summary>Answer</summary>

```ts
type RatioStatus = "applicable" | "not_applicable";

interface Ratio {
  name: string;
  fiscalYear: number;
  status: RatioStatus;
  value?: number;
  reason?: string;
}
```
</details>

**3.** What's wrong here, and what does TypeScript say?
```ts
async function companyName(cik: number): Promise<string> {
  const data = fetchSubmissions(cik);
  return data.name;
}
```
<details><summary>Answer</summary>

Missing `await`: `data` is a `Promise<Submissions>`, not the submissions themselves. TypeScript reports `Property 'name' does not exist on type 'Promise<Submissions>'`. Fix: `const data = await fetchSubmissions(cik);`.
</details>

## Cheat sheet

| You see | It means |
| --- | --- |
| `x: string` | x is a string |
| `string \| number` | either one |
| `"ok" \| "missing"` | only these exact values |
| `field?: string` | optional field (may be absent) |
| `a?.b` | `a.b`, or `undefined` if `a` is null/undefined |
| `a ?? b` | `a`, or `b` if `a` is null/undefined |
| `string[]`, `readonly string[]` | array of strings; read-only array |
| `Record<string, number>` | object with string keys and number values |
| `Promise<T>` | a T that arrives later; get it with `await` |
| `unknown` | anything; check before using |
| `any` | type checking off (avoid) |
| `export` / `import { x }` | share between files |
| `import type { T }` / `type T` | type-only import, erased at runtime |

Further reading: the [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html), especially "Everyday Types" and "Narrowing."
