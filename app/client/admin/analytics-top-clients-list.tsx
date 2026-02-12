import { formatFileSize } from '#app/helpers/format.ts'
import { colors, radius, spacing, typography } from '#app/styles/tokens.ts'

type TopClientSummary = {
	clientName: string
	downloadStarts: number
	mediaRequests: number
	uniqueClients: number
	bytesServed: number
	lastSeenAt: number | null
}

export function AnalyticsTopClientsList() {
	return ({ clients }: { clients: Array<TopClientSummary> }) => (
		<div>
			<h4
				css={{
					fontSize: typography.fontSize.sm,
					fontWeight: typography.fontWeight.semibold,
					margin: `0 0 ${spacing.sm} 0`,
					color: colors.text,
				}}
			>
				Top Clients
			</h4>
			{clients.length === 0 ? (
				<p
					css={{
						margin: 0,
						fontSize: typography.fontSize.sm,
						color: colors.textMuted,
					}}
				>
					No client analytics yet.
				</p>
			) : (
				<ul
					css={{
						listStyle: 'none',
						padding: 0,
						margin: 0,
						display: 'flex',
						flexDirection: 'column',
						gap: spacing.sm,
					}}
				>
					{clients.slice(0, 8).map((client, index) => (
						<li
							key={`${client.clientName}-${client.lastSeenAt ?? 0}-${index}`}
							css={{
								padding: spacing.sm,
								borderRadius: radius.md,
								border: `1px solid ${colors.border}`,
								backgroundColor: colors.background,
							}}
						>
							<div
								css={{
									fontSize: typography.fontSize.sm,
									fontWeight: typography.fontWeight.medium,
									color: colors.text,
								}}
							>
								{client.clientName}
							</div>
							<div
								css={{
									marginTop: spacing.xs,
									fontSize: typography.fontSize.xs,
									color: colors.textMuted,
									display: 'flex',
									gap: spacing.sm,
									flexWrap: 'wrap',
								}}
							>
								<span>{client.downloadStarts} starts</span>
								<span>{client.mediaRequests} requests</span>
								<span>{client.uniqueClients} clients</span>
								<span>{formatFileSize(client.bytesServed)}</span>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
