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
const sqliteCompatUrl = pathToFileURL(
	path.join(rootDir, 'app', 'db', 'sqlite.ts'),
).href

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === 'bun:test') {
			return {
				shortCircuit: true,
				url: bunTestCompatUrl,
			}
		}

		if (specifier === 'bun:sqlite') {
			return {
				shortCircuit: true,
				url: sqliteCompatUrl,
			}
		}

		return nextResolve(specifier, context)
	},
	load(url, context, nextLoad) {
		if (url.endsWith('.tsx')) {
			const filename = fileURLToPath(url)
			const source = readFileSync(filename, 'utf8')
			const transformed = transformSync(source, {
				format: 'esm',
				jsx: 'automatic',
				jsxImportSource: 'remix/component',
				loader: 'tsx',
				sourcefile: filename,
				sourcemap: 'inline',
				target: 'esnext',
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
