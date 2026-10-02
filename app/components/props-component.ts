import { type Handle, type RemixNode } from 'remix/component'

export function renderProps<Props>(
	handle: Handle<Props>,
	render: (props: Props) => RemixNode,
) {
	return () => render(handle.props)
}
