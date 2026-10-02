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
		// Property Inspector scripts run in Stream Deck's embedded browser.
		files: ["*.sdPlugin/ui/**/*.js"],
		languageOptions: {
			sourceType: "script",
			globals: globals.browser,
		},
	},
);
