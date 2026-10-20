import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".trigger/**",
    "artifacts/**",
    // Vendored React Bits components (installed with the shadcn CLI); updated by re-adding, not by hand.
    "src/components/reactbits/*.tsx",
  ]),
]);

export default eslintConfig;
