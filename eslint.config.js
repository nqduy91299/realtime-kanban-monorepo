// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist", "**/dist-e2e", "**/test-results", "**/playwright-report", "**/coverage"],
  },

  js.configs.recommended,

  // TypeScript, with type information: lets ESLint see e.g. a Promise that is never awaited.
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true, // each file is checked with the tsconfig.json of its own package
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Fire-and-forget is sometimes intended; we mark those with `void`.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Y.Text has a real toString() (it returns the text); its type definitions just don't show it.
      "@typescript-eslint/no-base-to-string": [
        "error",
        { ignoredTypeNames: ["Error", "RegExp", "URL", "URLSearchParams", "YText"] },
      ],
    },
  },

  // Tests: assertions on untyped JSON and `any`-ish fixtures are fine there.
  {
    files: ["**/test/**/*.ts", "apps/e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // React: rules of hooks + accessibility.
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat["recommended-latest"], jsxA11y.flatConfigs.recommended],
    languageOptions: { globals: globals.browser },
  },

  // Plain JS: the service worker and config files.
  {
    files: ["apps/web/public/sw.js"],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ["*.js"],
    languageOptions: { globals: globals.node },
  },

  // Last: turn off every rule that would fight with Prettier's formatting.
  prettier,
);
