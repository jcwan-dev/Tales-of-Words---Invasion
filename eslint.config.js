// Lint rules double as architecture rules. See CLAUDE.md "Code rules".
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/playwright-report/**", "**/test-results/**", "android/**"] },

  js.configs.recommended,
  ...tseslint.configs.strict,

  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },

  // Code rule 1 and 3: the rules core is pure, deterministic TypeScript.
  {
    files: ["packages/core/src/**/*.ts"],
    languageOptions: { globals: {} },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom", "react/*"], message: "core must not depend on the UI." },
            { group: ["@capacitor/*", "@capacitor-community/*", "@revenuecat/*"], message: "core must not depend on the platform." },
            { group: ["@tow/app", "@tow/platform", "@tow/narrative", "@tow/sim"], message: "core is the bottom layer; nothing above it may be imported." },
            { group: ["node:*", "fs", "path"], message: "core runs in the browser and in Node; no Node APIs." },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the context RNG stream (createRng / RngStreams)." },
        { object: "Date", property: "now", message: "Rules must not read the clock." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date']", message: "Rules must not read the clock." },
      ],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "setTimeout", "setInterval", "fetch"],
    },
  },

  // Platform may use core, never the app.
  {
    files: ["packages/platform/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@tow/app", "react", "react-dom"], message: "platform adapters must not depend on the UI." }] },
      ],
    },
  },

  // The app talks to ads and billing only through @tow/platform.
  {
    files: ["packages/app/src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@capacitor-community/admob", "@revenuecat/*"], message: "Use the adapters in @tow/platform (code rule 7)." },
          ],
        },
      ],
    },
  },
);
