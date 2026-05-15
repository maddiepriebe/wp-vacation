import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

// Treat underscore-prefixed identifiers as intentionally unused (standard convention).
config.push({
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
  },
});

config.push({
  files: ["src/**/__tests__/**/*.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
  ignores: [
    "src/test/with-tx.ts",
    "src/lib/actions/__tests__/transactions.test.ts",
    "src/test/__tests__/with-tx.test.ts",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@/db/client",
            importNames: ["db"],
            message:
              "Tests must take `tx` as a parameter (via withTx) rather than importing `db` directly. Only src/test/with-tx.ts is exempt.",
          },
        ],
      },
    ],
  },
});

export default config;
