import { run } from 'remix/node-hmr'

run('./index.ts', {
	nodeArgs: ['--import', 'remix/node-tsx', '--import', 'remix/ui-hmr/node'],
	watch: {
		ignore: [
			'**/node_modules/**',
			'**/.git/**',
			'data/**',
			'local-test/**',
			'**/*.test.*',
		],
	},
})
