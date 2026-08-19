import { expect, test } from 'vitest'
import '#app/config/init-env.ts'
import { db } from '#app/db/index.ts'
import { migrate } from '#app/db/migrations.ts'
import { generateAccessToken } from '#app/oauth/tokens.ts'
import { handleUnauthorized, resolveAuthInfo } from './auth.ts'

migrate(db)

test('handleUnauthorized advertises https resource metadata from Forwarded proto', () => {
	const request = new Request('http://mediarss.doddsfamily.us/mcp', {
		headers: {
			Forwarded: 'for=198.51.100.42;host=mediarss.doddsfamily.us;proto=https',
		},
	})

	const response = handleUnauthorized(request)
	const header = response.headers.get('WWW-Authenticate')

	expect(response.status).toBe(401)
	expect(header).toContain(
		'resource_metadata=https://mediarss.doddsfamily.us/.well-known/oauth-protected-resource/mcp',
	)
	expect(header).not.toContain('error="invalid_token"')
})

test('handleUnauthorized includes invalid_token details when auth header exists', () => {
	const request = new Request('http://localhost:22050/mcp', {
		headers: {
			Authorization: 'Bearer invalid-token',
		},
	})

	const response = handleUnauthorized(request)
	const header = response.headers.get('WWW-Authenticate')

	expect(header).toContain('error="invalid_token"')
	expect(header).toContain('error_description=')
})

test('resolveAuthInfo includes token expiry for the 2026 resource-server contract', async () => {
	const issuer = 'http://localhost'
	const { token } = await generateAccessToken({
		issuer,
		scope: 'mcp:read',
	})

	const authInfo = await resolveAuthInfo(`Bearer ${token}`, issuer)

	expect(authInfo).not.toBeNull()
	expect(authInfo?.scopes).toEqual(['mcp:read'])
	expect(authInfo?.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
})
