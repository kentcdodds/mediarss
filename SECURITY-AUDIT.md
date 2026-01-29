# Security Audit Report

**Audit Date:** January 13, 2026  
**Auditor:** Automated Security Analysis  
**Application:** MediaRSS

## Executive Summary

This security audit reviewed the MediaRSS codebase for common vulnerabilities including SQL injection, path traversal, authentication/authorization issues, XSS, and security misconfigurations. The application demonstrates solid security practices in several areas, but has critical issues that should be addressed before production deployment.

**Risk Summary:**
- Critical: 2 issues
- High: 4 issues  
- Medium: 3 issues
- Low: 2 issues

---

## Security Strengths

### 1. SQL Injection Protection ✅
All database queries use parameterized statements through SQLite's prepared statement API:
```typescript
db.query(sql`SELECT * FROM directory_feeds WHERE id = ?;`).get(id)
```
No string concatenation or interpolation in SQL queries was found.

### 2. Path Traversal Protection ✅
Multiple layers of defense:
- `nodePath.resolve()` to normalize paths
- Explicit containment validation (e.g., `resolvedFile.startsWith(resolvedDir + nodePath.sep)`)
- `realpath()` validation for symlink protection in MCP tools
- Explicit "Path traversal not allowed" error responses

### 3. PKCE Implementation ✅
OAuth implementation correctly requires PKCE with S256:
- Only S256 method is accepted (not plain)
- Code challenges are validated
- Code verifiers meet RFC 7636 requirements (43-128 chars)

### 4. Authorization Code Security ✅
- Codes expire after 10 minutes (RFC 6749 compliant)
- Single-use enforcement with atomic database UPDATE
- TOCTOU race condition prevention via conditional UPDATE

### 5. Token Generation ✅
- Feed tokens use 32 bytes of cryptographically secure random data
- UUIDv7 for IDs provides time-sortable, unique identifiers

### 6. Rate Limiting ✅
- Sliding window algorithm
- Different limits per route type (admin read/write, media, default)
- 10x penalty for failed requests (brute force protection)
- Configurable via environment variables

### 7. XSS Prevention ✅
- RSS generation uses proper XML escaping and CDATA wrapping
- HTML templating uses `@remix-run/html-template`

---

## Critical Issues

### CRITICAL-001: No Admin Authentication

**Severity:** CRITICAL  
**Location:** `/admin/*` routes  
**Description:**  
The admin routes have no authentication middleware. While code comments reference "Cloudflare Access" protection, there is no actual authentication enforcement in the application code.

**Impact:**  
Any user can access admin APIs to:
- Create, modify, and delete feeds
- Generate access tokens
- Browse media directories
- Upload files
- Modify all feed settings

**Evidence:**
```typescript
// app/routes/admin/index.tsx - No middleware
const adminShellHandler = {
  middleware: [],  // Empty - no auth!
  action() {
    return render(...)
  },
}
```

**Recommendation:**
1. Implement authentication middleware for all `/admin/*` routes
2. Options include:
   - Cloudflare Access JWT validation middleware
   - Session-based authentication
   - Basic authentication for simple deployments
   - OAuth 2.0 with required scope

**Remediation Priority:** IMMEDIATE

---

### CRITICAL-002: Host Header Injection / Issuer Spoofing

**Severity:** CRITICAL  
**Location:** `app/helpers/origin.ts`, OAuth token generation  
**Description:**  
The `getOrigin()` function trusts proxy headers (`X-Forwarded-Proto`, `CF-Visitor`) without validation. The `ALLOWED_HOSTS` check only exists in the token endpoint and is optional.

**Impact:**
- Attackers can inject arbitrary issuers into JWT tokens
- Tokens issued with spoofed issuers won't verify correctly, causing DoS
- Potential for token forgery if attacker controls a domain that matches

**Evidence:**
```typescript
// app/helpers/origin.ts
export function getOrigin(request: Request, url: URL): string {
  const proto = getProtocol(request, url)  // Trusts X-Forwarded-Proto
  return `${proto}//${url.host}`  // Host from URL, not validated
}
```

**Recommendation:**
1. Make `ALLOWED_HOSTS` mandatory in production
2. Validate Host header against allowed hosts in all OAuth operations
3. Add middleware to reject requests with invalid Host headers

**Remediation Priority:** IMMEDIATE

---

## High Severity Issues

### HIGH-001: Private Keys Stored in Database

**Severity:** HIGH  
**Location:** `app/oauth/keys.ts`  
**Description:**  
RSA private keys for JWT signing are stored as JSON in the SQLite database.

**Impact:**  
If the database is accessed (backup exposure, SQL injection elsewhere, file access), attackers can forge valid JWT tokens.

**Recommendation:**
1. Store keys in environment variables or a secrets manager
2. Use hardware security modules (HSM) for production
3. At minimum, encrypt keys at rest with a separate key

---

### HIGH-002: Missing CSRF Protection

**Severity:** HIGH  
**Location:** `app/routes/admin/authorize.tsx`  
**Description:**  
The OAuth authorization endpoint accepts POST requests without CSRF token validation.

**Impact:**  
An attacker could craft a malicious page that auto-submits the authorization form, granting themselves access tokens.

**Recommendation:**
1. Implement CSRF tokens for the authorization form
2. Use SameSite cookies with Strict mode
3. Verify Referer header matches expected origin

---

### HIGH-003: Missing Security Headers

**Severity:** HIGH  
**Location:** Global response handling  
**Description:**  
Common security headers are not set on responses.

**Missing Headers:**
- `Content-Security-Policy` - Prevents XSS and data injection
- `X-Frame-Options` - Prevents clickjacking
- `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
- `Strict-Transport-Security` - Enforces HTTPS

**Recommendation:**
Add middleware to set security headers on all responses:
```typescript
headers.set('X-Content-Type-Options', 'nosniff')
headers.set('X-Frame-Options', 'DENY')
headers.set('Content-Security-Policy', "default-src 'self'")
headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
```

---

### HIGH-004: Default OAuth Client Accepts localhost

**Severity:** HIGH (in production)  
**Location:** `app/oauth/clients.ts`  
**Description:**  
The default MCP client accepts localhost redirect URIs which could be exploited in production.

**Recommendation:**
1. Remove localhost redirects in production builds
2. Make redirect URIs configurable via environment
3. Log warnings when localhost redirects are used

---

## Medium Severity Issues

### MEDIUM-001: Verbose Error Messages

**Severity:** MEDIUM  
**Location:** Various API routes  
**Description:**  
Some error messages expose internal details like media root names and path structures.

**Recommendation:**
Use generic error messages for clients while logging details server-side.

---

### MEDIUM-002: No Request Body Size Limits

**Severity:** MEDIUM  
**Location:** JSON API endpoints  
**Description:**  
No explicit limits on JSON body sizes (except file uploads).

**Impact:**  
Memory exhaustion through large JSON payloads.

**Recommendation:**
Add body size limits middleware for API routes.

---

### MEDIUM-003: MCP Session Management

**Severity:** MEDIUM  
**Location:** `app/routes/mcp/index.ts`  
**Description:**  
While session IDs are randomly generated, there's no additional session binding (e.g., to IP address or user agent).

**Recommendation:**
Consider binding sessions to client fingerprint for enhanced security.

---

## Low Severity Issues

### LOW-001: Missing Cache-Control Headers

**Severity:** LOW  
**Location:** Various API responses  
**Description:**  
Some API responses don't include `Cache-Control: no-store` headers.

**Recommendation:**
Add no-store headers to all authenticated/sensitive API responses.

---

### LOW-002: Information Disclosure in Error Responses

**Severity:** LOW  
**Location:** Various routes  
**Description:**  
Different error messages for different 404 scenarios could allow enumeration.

**Recommendation:**
Standardize 404 responses to prevent information leakage.

---

## Positive Security Findings

1. **Atomic Authorization Code Consumption** - Prevents replay attacks
2. **Token Expiration** - Access tokens expire after 1 hour
3. **Feed Token Isolation** - Tokens are scoped to specific feeds
4. **Rate Limiting with Penalties** - Effective brute force protection
5. **File Type Validation** - Media uploads validate MIME types
6. **Filename Sanitization** - Upload filenames are properly sanitized

---

## Recommendations Summary

### Immediate Actions (Before Production)
1. ⚠️ Implement admin authentication middleware
2. ⚠️ Make `ALLOWED_HOSTS` mandatory and validate Host headers
3. Add security headers middleware
4. Implement CSRF protection for OAuth authorize

### Short-term Actions
1. Move private keys out of database
2. Remove localhost redirects from production OAuth clients
3. Add request body size limits
4. Review and standardize error messages

### Long-term Improvements
1. Implement audit logging for admin actions
2. Add session binding for MCP connections
3. Consider rate limiting per user in addition to per IP
4. Implement Content-Security-Policy

---

## Audit Methodology

This audit examined:
- Source code review of all routes and middleware
- Authentication and authorization flows
- Database query patterns
- File handling and path operations
- Input validation and sanitization
- Error handling and information disclosure
- Security header configuration
- OAuth 2.0 implementation compliance
- Rate limiting effectiveness

---

*This audit report should be reviewed by the development team and security stakeholders. Critical issues should be addressed before production deployment.*
