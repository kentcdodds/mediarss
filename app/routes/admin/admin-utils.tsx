import { redirect } from 'remix/response/redirect'
import { type RemixNode, css as rmxCss } from 'remix/ui'
import { ServerDocument } from '#app/components/server-document.tsx'
import { getCuratedFeedById } from '#app/db/curated-feeds.ts'
import { getDirectoryFeedById } from '#app/db/directory-feeds.ts'
import { type Feed } from '#app/db/types.ts'
import { renderUi } from '#app/helpers/render.ts'
import {
	colors,
	mq,
	responsive,
	spacing,
	typography,
} from '#app/styles/tokens.ts'
import { AdminEnhancement } from '#app/client/admin/enhanced-form.tsx'
import { headerStyle, mainStyle, pageStyle } from './admin-styles.ts'

export type AdminPageOptions = {
	title: string
	body: RemixNode
	status?: number
	isVersionPage?: boolean
	target?: string | null
}

export function renderAdminPage({
	title,
	body,
	status = 200,
	isVersionPage = false,
	target,
}: AdminPageOptions) {
	if (target === 'admin-main') {
		return renderUi(body, { status })
	}

	return renderUi(
		<ServerDocument
			title={title}
			entryScript="/app/client/admin/admin-entry.ts"
		>
			<div mix={pageStyle}>
				<header mix={headerStyle}>
					<a
						href="/admin"
						mix={rmxCss({
							display: 'flex',
							alignItems: 'center',
							gap: spacing.md,
							textDecoration: 'none',
						})}
					>
						<img src="/assets/logo.svg" alt="MediaRSS" width="36" height="36" />
						<h1
							mix={rmxCss({
								fontSize: typography.fontSize.lg,
								fontWeight: typography.fontWeight.semibold,
								color: colors.text,
								margin: 0,
							})}
						>
							MediaRSS
						</h1>
						<span
							mix={rmxCss({
								fontSize: typography.fontSize.sm,
								color: colors.textMuted,
								[mq.mobile]: {
									display: 'none',
								},
							})}
						>
							Admin
						</span>
					</a>
				</header>
				<main mix={mainStyle}>
					<AdminEnhancement />
					<div data-admin-frame>{body}</div>
				</main>
				<footer
					mix={rmxCss({
						borderTop: `1px solid ${colors.border}`,
						padding: `${spacing.md} ${responsive.spacingHeader}`,
						display: 'flex',
						justifyContent: 'center',
						alignItems: 'center',
					})}
				>
					{isVersionPage ? (
						<span
							mix={rmxCss({
								fontSize: typography.fontSize.xs,
								color: colors.textMuted,
							})}
						>
							...
						</span>
					) : (
						<a
							href="/admin/version"
							mix={rmxCss({
								fontSize: typography.fontSize.xs,
								color: colors.textMuted,
								textDecoration: 'none',
								'&:hover': {
									color: colors.primary,
								},
							})}
						>
							...
						</a>
					)}
				</footer>
			</div>
		</ServerDocument>,
		{ status },
	)
}

export function redirect303(href: string) {
	return redirect(href, 303)
}

export async function getAdminFeed(feedId: string): Promise<Feed | undefined> {
	return (
		(await getDirectoryFeedById(feedId)) ?? (await getCuratedFeedById(feedId))
	)
}

export class AdminFormError extends Error {
	constructor(
		message: string,
		readonly href: string = '/admin',
	) {
		super(message)
		this.name = 'AdminFormError'
	}
}

export function getRequiredString(formData: FormData, name: string) {
	const value = formData.get(name)
	if (typeof value !== 'string' || value.trim() === '') {
		throw new AdminFormError(`Missing required form field "${name}"`)
	}
	return value
}

export function getOptionalString(formData: FormData, name: string) {
	const value = formData.get(name)
	if (typeof value !== 'string') return null
	const trimmed = value.trim()
	return trimmed || null
}

export function getAllStringValues(formData: FormData, name: string) {
	return formData
		.getAll(name)
		.filter(
			(value): value is string => typeof value === 'string' && value !== '',
		)
}

export function getLineValues(formData: FormData, name: string) {
	return (getOptionalString(formData, name) ?? '')
		.split(/\r?\n/)
		.map((value) => value.trim())
		.filter(Boolean)
}
