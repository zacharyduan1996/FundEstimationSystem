import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".next_bak_*/**",
    ".next_prev_*/**",
    "node_modules/**",
    "coverage/**",
    "docs/images/**"
  ])
]);
