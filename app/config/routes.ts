import { route } from '@remix-run/fetch-router'

export default route({
	home: '/',
	feed: '/feed/:token',
	media: '/media/:token/*path',
	art: '/art/:token/*path',
})
