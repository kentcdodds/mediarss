import fs from 'node:fs'
import path from 'node:path'

type PackageJson = {
	exports?: Record<string, { default?: string; types?: string } | string>
	module?: string
	main?: string
}

/**
 * Resolves a package specifier to the actual file path
 */
function resolvePackageExport(
	specifier: string,
	rootDir: string,
): string | null {
	const parts = specifier.split('/')
	let packageName: string
	let subpathParts: string[]

	if (specifier.startsWith('@')) {
		if (parts.length < 2) return null
		packageName = `${parts[0]}/${parts[1]}`
		subpathParts = parts.slice(2)
	} else {
		if (parts.length === 0 || !parts[0]) return null
		packageName = parts[0]
		subpathParts = parts.slice(1)
	}

	const subpath = subpathParts.length > 0 ? `./${subpathParts.join('/')}` : '.'
	const packageDir = path.join(rootDir, 'node_modules', packageName)
	const packageJsonPath = path.join(packageDir, 'package.json')

	if (!fs.existsSync(packageJsonPath)) return null

	const packageJson = JSON.parse(
		fs.readFileSync(packageJsonPath, 'utf-8'),
	) as PackageJson

	// If no exports field, fall back to module or main field
	if (!packageJson.exports) {
		// Prefer ESM module over CommonJS main
		const entryFile = packageJson.module || packageJson.main
		if (entryFile) {
			const entryPath = path.join(packageDir, entryFile)
			if (fs.existsSync(entryPath)) return entryPath
		}
		// Last resort: look for index.js
		const indexPath = path.join(packageDir, 'index.js')
		return fs.existsSync(indexPath) ? indexPath : null
	}

	const exportEntry = packageJson.exports[subpath]
	if (!exportEntry) return null

	const exportPath =
		typeof exportEntry === 'string'
			? exportEntry
			: exportEntry.default || exportEntry.types

	if (!exportPath) return null

	const resolvedPath = path.join(packageDir, exportPath)
	return fs.existsSync(resolvedPath) ? resolvedPath : null
}

/**
 * CORS headers for bundled JavaScript modules.
 * These need to be accessible cross-origin for MCP widgets embedded in external apps.
 */
const BUNDLING_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
	'Access-Control-Allow-Headers': 'Accept, Content-Type',
} as const

export function createBundlingRoutes(rootDir: string) {
	const clientDir = path.resolve(rootDir, 'app', 'client')

	return {
		'/app/client/*': async (request: Request) => {
			// Handle CORS preflight requests
			if (request.method === 'OPTIONS') {
				return new Response(null, {
					status: 204,
					headers: {
						...BUNDLING_CORS_HEADERS,
						'Access-Control-Max-Age': '86400',
					},
				})
			}

			const url = new URL(request.url)
			const reqPath = path.posix.normalize(url.pathname.replace(/^\/+/, ''))
			const resolved = path.resolve(rootDir, reqPath)

			// Security: only allow files within /app/client/
			if (!resolved.startsWith(clientDir + path.sep)) {
				return new Response('Forbidden', {
					status: 403,
					headers: BUNDLING_CORS_HEADERS,
				})
			}

			// Only allow .ts and .tsx files
			if (!resolved.endsWith('.ts') && !resolved.endsWith('.tsx')) {
				return new Response('Not Found', {
					status: 404,
					headers: BUNDLING_CORS_HEADERS,
				})
			}

			// Check file exists
			if (!fs.existsSync(resolved)) {
				return new Response('Not Found', {
					status: 404,
					headers: BUNDLING_CORS_HEADERS,
				})
			}

			const filepath = resolved

			// Bundle entry files WITHOUT externals so that all dependencies
			// share singleton instances (e.g., the interactions Map)
			const {
				outputs: [output],
			} = await Bun.build({
				entrypoints: [filepath],
				target: 'browser',
				minify: Bun.env.NODE_ENV === 'production',
				splitting: false,
				format: 'esm',
				sourcemap: Bun.env.NODE_ENV === 'production' ? 'none' : 'inline',
				jsx: { importSource: 'remix/component' },
				// No externals - bundle everything together
			})

			return new Response(output, {
				headers: {
					'Content-Type': 'application/javascript',
					...BUNDLING_CORS_HEADERS,
				},
			})
		},

		'/node_modules/*': async (request: Request) => {
			// Handle CORS preflight requests
			if (request.method === 'OPTIONS') {
				return new Response(null, {
					status: 204,
					headers: {
						...BUNDLING_CORS_HEADERS,
						'Access-Control-Max-Age': '86400',
					},
				})
			}

			const url = new URL(request.url)
			const specifier = url.pathname.replace('/node_modules/', '')
			const filepath = resolvePackageExport(specifier, rootDir)

			if (!filepath) {
				return new Response('Package not found', {
					status: 404,
					headers: BUNDLING_CORS_HEADERS,
				})
			}

			const {
				outputs: [output],
			} = await Bun.build({
				entrypoints: [filepath],
				target: 'browser',
				minify: Bun.env.NODE_ENV === 'production',
				splitting: false,
				format: 'esm',
				sourcemap: Bun.env.NODE_ENV === 'production' ? 'none' : 'inline',
			})

			return new Response(output, {
				headers: {
					'Content-Type': 'application/javascript',
					'Cache-Control':
						Bun.env.NODE_ENV === 'production'
							? 'public, max-age=31536000, immutable'
							: 'no-cache',
					...BUNDLING_CORS_HEADERS,
				},
			})
		},
	}
}
