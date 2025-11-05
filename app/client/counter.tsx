import { hydrated, type Remix } from '@remix-run/dom'
import { press } from '@remix-run/events/press'

type Props = { initial?: number }

export const Counter = hydrated<Props>(
	'/dist/counter.js#Counter',
	function Counter({ initial }) {
		return () => (
			<>
				<PlainCounter initial={initial} />
			</>
		)
	},
)

function PlainCounter(this: Remix.Handle, { initial }: Props) {
	let count = initial ?? 0
	return () => (
		<button
			type="button"
			on={[
				press(() => {
					count++
					this.update()
				}),
			]}
		>
			Plain Counter: <span>{count}</span>
		</button>
	)
}
