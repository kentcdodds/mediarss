import * as FS from 'node:fs'
import * as Path from 'node:path'

/**
 * Resolves a package specifier (e.g., "@remix-run/dom/jsx-dev-runtime") to the actual file path
 * by reading the package.json exports field
 */
export function resolvePackageExport(
	specifier: string,
	rootDir: string,
): string | null {
	// Handle scoped packages (e.g., "@remix-run/dom/jsx-dev-runtime")
	// Split by '/' but keep scoped package names together
	const parts = specifier.split('/')
	let packageName: string
	let subpathParts: string[]

	if (specifier.startsWith('@')) {
		// Scoped package: "@remix-run/dom" or "@remix-run/dom/jsx-dev-runtime"
		if (parts.length < 2) {
			return null
		}
		packageName = `${parts[0]}/${parts[1]}`
		subpathParts = parts.slice(2)
	} else {
		// Regular package: "dom" or "dom/subpath"
		if (parts.length === 0 || !parts[0]) {
			return null
		}
		packageName = parts[0]
		subpathParts = parts.slice(1)
	}

	const subpath = subpathParts.length > 0 ? `./${subpathParts.join('/')}` : '.'

	const packageDir = Path.join(rootDir, 'node_modules', packageName)
	const packageJsonPath = Path.join(packageDir, 'package.json')

	if (!FS.existsSync(packageJsonPath)) {
		return null
	}

	const packageJson = JSON.parse(FS.readFileSync(packageJsonPath, 'utf-8')) as {
		exports?: Record<string, { default?: string; types?: string } | string>
	}

	if (!packageJson.exports) {
		// Fallback to index.js if no exports field
		const indexPath = Path.join(packageDir, 'index.js')
		return FS.existsSync(indexPath) ? indexPath : null
	}

	// Resolve subpath export
	const exportEntry = packageJson.exports[subpath]
	if (!exportEntry) {
		return null
	}

	const exportPath =
		typeof exportEntry === 'string'
			? exportEntry
			: exportEntry.default || exportEntry.types

	if (!exportPath) {
		return null
	}

	const resolvedPath = Path.join(packageDir, exportPath)
	return FS.existsSync(resolvedPath) ? resolvedPath : null
}

const buildOptions = {
	target: 'browser' as const,
	minify: Bun.env.NODE_ENV === 'production',
	splitting: false,
	format: 'esm' as const,
	sourcemap: Bun.env.NODE_ENV === 'production' ? ('none' as const) : ('inline' as const),
	jsx: { importSource: '@remix-run/dom' },
	external: ['@remix-run/*'],
	naming: {
		entry: '[dir]/[name].[ext]',
		chunk: 'chunks/[hash].[ext]',
		asset: 'assets/[name]-[hash].[ext]',
	},
}

export function createBundlingRoutes(rootDir: string) {
	return {
		'/dist/*': async (request: Request) => {
			const url = new URL(request.url)

			const filepath = Path.join(
				rootDir,
				url.pathname.replace('/dist', '/app/client'),
			)

			const {
				outputs: [output],
			} = await Bun.build({
				entrypoints: [filepath],
				...buildOptions,
			})

			return new Response(output)
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
				...buildOptions,
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

