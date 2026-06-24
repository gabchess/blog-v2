import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // shadcn components co-export cva variants and context hooks alongside
      // the component. Allow both so we don't fork or re-shape upstream files.
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: [
            "useCarousel",
            "useComboboxAnchor",
            "useDirection",
            "useSidebar",
            "toast",
          ],
        },
      ],
      // A few shadcn primitives (carousel, markdown-editor, use-mobile) sync
      // embla / media-query / DOM state inside an effect, which is the upstream
      // pattern. Surface it as a warning rather than fork the vendored files.
      "react-hooks/set-state-in-effect": "warn",
      // Stored-XSS guard. The single intentional escape lives in
      // chart.tsx (CSS-vars `<style>`) and is exempted in-line.
      "react/no-danger": "error",
    },
  },
]);
