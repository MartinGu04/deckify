import eslint from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
	globalIgnores(["node_modules/", "dist/", "*.sdPlugin/bin/", "*.sdPlugin/logs/"]),
	eslint.configs.recommended,
	{
		files: ["src/**/*.ts"],
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
		},
	},
	{
		files: ["**/*.mjs"],
		languageOptions: {
			globals: globals.node,
		},
	},
);
