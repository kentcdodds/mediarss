import { faker } from '@faker-js/faker'
import bcrypt from 'bcryptjs'
import { UniqueEnforcer } from 'enforce-unique'

const uniqueUsernameEnforcer = new UniqueEnforcer()

export function createUser() {
	const firstName = faker.person.firstName()
	const lastName = faker.person.lastName()

	const username = uniqueUsernameEnforcer
		.enforce(() => {
			return (
				faker.string.alphanumeric({ length: 2 }) +
				'_' +
				faker.internet.username({
					firstName: firstName.toLowerCase(),
					lastName: lastName.toLowerCase(),
				})
			)
		})
		.slice(0, 20)
		.toLowerCase()
		.replace(/[^a-z0-9_]/g, '_')
	return {
		username,
		name: `${firstName} ${lastName}`,
	}
}

export function createPassword(password: string = faker.internet.password()) {
	return {
		hash: bcrypt.hashSync(password, 10),
	}
}

export function getFeedImages() {
	return [
		{
			description: 'a nice country house',
			filePath: 'images/feeds/0.png',
			title: 'Country House',
		},
		{
			description: 'a city scape',
			filePath: 'images/feeds/1.png',
			title: 'Urban Vista',
		},
		{
			description: 'a sunrise',
			filePath: 'images/feeds/2.png',
			title: 'Morning Glory',
		},
		{
			description: 'a group of friends',
			filePath: 'images/feeds/3.png',
			title: 'Friends Together',
		},
		{
			description: 'friends being inclusive of someone who looks lonely',
			filePath: 'images/feeds/4.png',
			title: 'Welcoming Friends',
		},
		{
			description: 'an illustration of a hot air balloon',
			filePath: 'images/feeds/5.png',
			title: 'Balloon Adventure',
		},
		{
			description:
				'an office full of laptops and other office equipment that look like it was abandoned in a rush out of the building in an emergency years ago.',
			filePath: 'images/feeds/6.png',
			title: 'Abandoned Office',
		},
		{
			description: 'a rusty lock',
			filePath: 'images/feeds/7.png',
			title: 'Time-worn Security',
		},
		{
			description: 'something very happy in nature',
			filePath: 'images/feeds/8.png',
			title: 'Natural Joy',
		},
		{
			description: `someone at the end of a cry session who's starting to feel a little better.`,
			filePath: 'images/feeds/9.png',
			title: 'Hope Returns',
		},
	]
}

export function getRandomMediaFiles({ min = 1, max = 5 } = {}) {
	const files = [
		'/audiobooks/Free- The Secret Life of Walter Mitty.mp3',
		'/audiobooks/Rhythm of War The Stormlight Archive, Book 4.mp3',
		'/audiobooks/dramatized/Scripture Scouts-The Book of Mormon.mp3',
		'/audiobooks/dramatized/The Last Battle (Dramatized).mp3',
		'/audiobooks/kids/Mr. Poppers Penguins.mp3',
		'/audiobooks/kids/The Odious Ogre.mp3',
		'/family-videos/koala.mp4',
	]

	const directories = [
		'/audiobooks',
		'/audiobooks/dramatized',
		'/audiobooks/kids',
		'/family-videos',
	]

	const rootDirectory = ''

	// 50% chance to just get files
	if (faker.number.int(100) < 50) {
		const selectedCount = faker.number.int({
			min,
			max: Math.min(max, files.length),
		})
		const selectedFiles = faker.helpers.arrayElements(files, selectedCount)
		return selectedFiles.map((filePath) => ({ filePath }))
	}

	// For the remaining 50%, we might get directories
	const allPaths = [...files]

	// 50% chance to include regular directories
	if (faker.number.int(100) < 50) {
		allPaths.push(...directories)
	}

	// Only 30% chance to include the root media directory
	if (faker.number.int(100) < 30) {
		allPaths.push(rootDirectory)
	}

	const selectedCount = faker.number.int({
		min,
		max: Math.min(max, allPaths.length),
	})
	const initialSelection = faker.helpers.arrayElements(allPaths, selectedCount)

	// Remove any paths that are subsets of other selected paths
	const finalSelection = initialSelection.filter((path) => {
		const isSubset = initialSelection.some((otherPath) => {
			if (path === otherPath) return false
			return path.startsWith(otherPath + '/')
		})
		return !isSubset
	})

	return finalSelection.map((filePath) => ({ filePath }))
}
