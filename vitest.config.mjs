import ts from "typescript";
import { defineConfig } from "vitest/config";

/**
 * Vite's default transformer does not lower standard (stage 3) decorators, which the Stream Deck SDK's `@action` uses. Files that contain
 * decorators are compiled with the TypeScript compiler instead, matching the production Rollup build.
 * @returns Vite plugin.
 */
function typescriptDecorators() {
	return {
		name: "deckify:typescript-decorators",
		enforce: "pre",
		transform(code, id) {
			if (!id.endsWith(".ts") || !/^\s*@\w+/m.test(code)) {
				return null;
			}
			const output = ts.transpileModule(code, {
				fileName: id,
				compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: true },
			});
			return { code: output.outputText, map: output.sourceMapText };
		},
	};
}

export default defineConfig({
	plugins: [typescriptDecorators()],
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		restoreMocks: true,
		unstubGlobals: true,
	},
});
