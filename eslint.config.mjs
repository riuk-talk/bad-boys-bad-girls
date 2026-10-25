import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "lib/supabase/database.types.ts",
    // Separate project (Android game), not part of the Next.js app.
    "flip7-android/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "react/no-danger": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message: "Use Link from @/i18n/navigation so the locale is preserved.",
            },
          ],
        },
      ],
    },
  },
  {
    // The secret Supabase key must never reach a client bundle (CLAUDE.md).
    files: ["**/*.tsx"],
    ignores: ["lib/supabase/admin.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='process'][property.name='SUPABASE_SECRET_KEY']",
          message: "SUPABASE_SECRET_KEY may only be read in lib/supabase/admin.ts.",
        },
      ],
    },
  },
  {
    // Node scripts.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly", URL: "readonly" } },
  },
]);
