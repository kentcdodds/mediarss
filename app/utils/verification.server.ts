import { createCookieSessionStorage } from 'react-router'

export const verifySessionStorage = createCookieSessionStorage({
	cookie: {
		name: 'en_verification',
		sameSite: 'lax', // CSRF protection is advised if changing to 'none'
		path: '/',
		httpOnly: true,
		maxAge: 60 * 10, // 10 minutes
		secrets: process.env.SESSION_SECRET.split(','),
		// because people run this app on their local networks and it's annoying
		// to set up HTTPS for local networks.
		secure: false,
	},
})
