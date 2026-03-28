import { readFileSync } from 'node:fs'
import { enableCompileCache, registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transformSync } from 'esbuild'

enableCompileCache()

const thisFile = fileURLToPath(import.meta.url)
const thisDir = path.dirname(thisFile)
const rootDir = path.resolve(thisDir, '..')

const bunTestCompatUrl = pathToFileURL(
	path.join(rootDir, 'test', 'bun-test-compat.ts'),
).href

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'bun:test') {
			return {
				shortCircuit: true,
				url: bunTestCompatUrl,
			}
		}

		return nextResolve(specifier, context)
	},
	load(url, context, nextLoad) {
		if (url.endsWith('.tsx') || url.endsWith('.ts')) {
			const filename = fileURLToPath(url)
			const source = readFileSync(filename, 'utf8')
			const transformed = transformSync(source, {
				format: 'esm',
				jsx: 'automatic',
				jsxImportSource: 'remix/component',
				loader: url.endsWith('.tsx') ? 'tsx' : 'ts',
				sourcefile: filename,
				sourcemap: 'inline',
				target: 'esnext',
				tsconfigRaw: {
					compilerOptions: {
						verbatimModuleSyntax: true,
					},
				},
			})

			return {
				format: 'module',
				shortCircuit: true,
				source: transformed.code,
			}
		}

		return nextLoad(url, context)
	},
})
