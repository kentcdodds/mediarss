import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { getDomainUrl, getFeedImgSrc } from '#app/utils/misc.tsx'
import { type Route } from './+types/download-user-data.ts'

export async function loader({ request }: Route.LoaderArgs) {
	const userId = await requireUserId(request)
	const user = await prisma.user.findUniqueOrThrow({
		where: { id: userId },
		include: {
			feeds: {
				select: {
					image: {
						select: {
							id: true,
							link: true,
							title: true,
							description: true,
						},
					},
					media: true,
					subscribers: {
						select: {
							user: {
								select: {
									id: true,
									name: true,
									username: true,
								},
							},
						},
					},
				},
			},
			password: false, // <-- intentionally omit password
			sessions: true,
			roles: true,
		},
	})

	const domain = getDomainUrl(request)

	return Response.json({
		user: {
			...user,
			feeds: user.feeds.map((feed) => ({
				...feed,
				image: feed.image
					? {
							...feed.image,
							url: domain + getFeedImgSrc(feed.image.id),
						}
					: null,
			})),
		},
	})
}
