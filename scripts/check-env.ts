// Prints which environment variables are set and valid, never their values.
// Run with: npm run check:env   (Node loads .env.local via --env-file-if-exists)
import { checkEnv, envIsReady } from "../src/lib/env.ts";

const results = checkEnv(process.env);

for (const r of results) {
  if (r.status === "ok") {
    console.log(`  ok    ${r.name}`);
  } else if (!r.required && r.status === "missing") {
    console.log(`  later ${r.name}: not set (optional for now)`);
  } else {
    console.log(`  FIX   ${r.name}: ${r.problem ?? r.status}`);
  }
}

if (envIsReady(results)) {
  console.log("\nEnvironment ready.");
} else {
  console.log("\nSome variables need fixing in .env.local (see FIX lines above).");
  process.exitCode = 1;
}
