import fs from 'node:fs'
import path from 'node:path'

type PackageJson = {
	exports?: Record<string, { default?: string; types?: string } | string>
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

	if (!packageJson.exports) {
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

export function createBundlingRoutes(rootDir: string) {
	return {
		'/dist/*': async (request: Request) => {
			const url = new URL(request.url)
			const filepath = path.join(
				rootDir,
				url.pathname.replace('/dist', '/app/client'),
			)

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
				jsx: { importSource: '@remix-run/component' },
				// No externals - bundle everything together
			})

			return new Response(output, {
				headers: { 'Content-Type': 'application/javascript' },
			})
		},

		'/node_modules/*': async (request: Request) => {
			const url = new URL(request.url)
			const specifier = url.pathname.replace('/node_modules/', '')
			const filepath = resolvePackageExport(specifier, rootDir)

			if (!filepath) {
				return new Response('Package not found', { status: 404 })
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
				},
			})
		},
	}
}
