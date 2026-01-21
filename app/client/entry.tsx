import { createRoot } from 'remix/component'
import { colors, spacing, typography } from '#app/styles/tokens.ts'
import { Counter } from './counter.tsx'

function App() {
	return (
		<main
			css={{
				fontFamily: typography.fontFamily,
				maxWidth: '600px',
				margin: '0 auto',
				padding: spacing['2xl'],
			}}
		>
			<h1
				css={{
					fontSize: typography.fontSize['2xl'],
					fontWeight: typography.fontWeight.semibold,
					marginBottom: spacing.lg,
					color: colors.text,
				}}
			>
				Home
			</h1>
			<Counter initial={5} />
		</main>
	)
}

const rootElement = document.getElementById('root') ?? document.body
createRoot(rootElement).render(<App />)
