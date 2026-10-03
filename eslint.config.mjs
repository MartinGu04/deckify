import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
	globalIgnores(["node_modules/", "dist/", "*.sdPlugin/bin/", "*.sdPlugin/logs/"]),
	eslint.configs.recommended,
	{
		files: ["src/**/*.ts", "test/**/*.ts"],
		extends: [tseslint.configs.strictTypeChecked],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// Stream Deck SDK calls return promises; dropping one would hide failures.
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
		},
	},
	{
		// Mock assertions (`expect(mock.method)`) and terse callbacks are idiomatic in tests.
		files: ["test/**/*.ts"],
		rules: {
			"@typescript-eslint/unbound-method": "off",
			"@typescript-eslint/no-confusing-void-expression": "off",
		},
	},
	{
		files: ["**/*.mjs"],
		languageOptions: {
			globals: globals.node,
		},
	},
	{
		// The promo film runs in a browser page (ES modules), except the bridge injected into Deckify Setup (a classic script).
		files: ["film/src/**/*.js"],
		languageOptions: {
			sourceType: "module",
			globals: globals.browser,
		},
	},
	{
		files: ["film/src/setup-bridge.js"],
		languageOptions: {
			sourceType: "script",
		},
	},
	{
		// Property Inspector scripts run in Stream Deck's embedded browser.
		files: ["*.sdPlugin/ui/**/*.js"],
		languageOptions: {
			sourceType: "script",
			globals: globals.browser,
		},
	},
);
