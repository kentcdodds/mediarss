import { faker } from '@faker-js/faker'
import { prisma } from '#app/utils/db.server.ts'
import {
	createPassword,
	createUser,
	getFeedImages,
	getRandomMediaFiles,
} from '#tests/db-utils.ts'

async function seed() {
	console.log('🌱 Seeding...')
	console.time(`🌱 Database has been seeded`)

	const totalUsers = 5
	console.time(`👤 Created ${totalUsers} users...`)
	const feedImages = getFeedImages()
	const createdUsers: Array<{ id: string }> = []

	for (let index = 0; index < totalUsers; index++) {
		const userData = createUser()
		const user = await prisma.user.create({
			select: { id: true },
			data: {
				...userData,
				password: { create: createPassword(userData.username) },
				roles: { connect: { name: 'user' } },
			},
		})
		createdUsers.push(user)
	}
	console.timeEnd(`👤 Created ${totalUsers} users...`)

	// Create feeds for each user
	console.time('📡 Creating feeds...')
	for (const user of createdUsers) {
		const numberOfFeeds = faker.number.int(3) + 1 // 1 to 3 feeds

		for (let i = 0; i < numberOfFeeds; i++) {
			const feed = await prisma.feed.create({
				data: {
					name: faker.lorem.words({ min: 2, max: 4 }),
					description: faker.lorem.sentence(),
					sort: 'chronological',
					sortDirection: faker.helpers.arrayElement([
						'ascending',
						'descending',
					]),
					overrides: faker.datatype.boolean()
						? {
								title: faker.lorem.words(),
								description: faker.lorem.paragraph(),
								dbNull: null,
							}
						: undefined,
					owner: {
						connect: { id: user.id },
					},
					// Add a random feed image
					image: {
						create: faker.helpers.arrayElement(feedImages),
					},
					// Add some random media files from our predefined set
					media: {
						create: getRandomMediaFiles({ min: 1, max: 5 }),
					},
				},
			})

			// Add some random subscriptions from other users
			const otherUsers = createdUsers.filter((u) => u.id !== user.id)
			const subscriberCount = faker.number.int(otherUsers.length)
			const subscribers = faker.helpers.arrayElements(
				otherUsers,
				subscriberCount,
			)

			if (subscribers.length > 0) {
				await prisma.feedSubscription.createMany({
					data: subscribers.map((subscriber) => ({
						userId: subscriber.id,
						feedId: feed.id,
					})),
				})
			}
		}
	}
	console.timeEnd('📡 Creating feeds...')

	console.timeEnd(`🌱 Database has been seeded`)
}

seed()
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})

// we're ok to import from the test directory in this file
/*
eslint
	no-restricted-imports: "off",
*/
