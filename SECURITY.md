# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | Yes                |
| < 1.0   | Best effort        |

## Reporting a Vulnerability

We take security seriously at WorldPulse. If you discover a security issue, please report it responsibly.

**Do NOT open a public GitHub issue for security problems.**

Instead, please email **security@world-pulse.io** with:

1. A description of the issue
2. Steps to reproduce (if applicable)
3. The potential impact
4. Any suggested fixes (optional but appreciated)

### What to expect

- **Acknowledgement** within 48 hours
- **Initial assessment** within 5 business days
- **Resolution timeline** communicated after assessment
- **Credit** in the security advisory (unless you prefer to remain anonymous)

### Scope

The following are in scope:

- The WorldPulse web application (world-pulse.io)
- The WorldPulse API (api.world-pulse.io)
- The WorldPulse scraper pipeline
- Official Docker images and deployment configs
- Browser extensions (Chrome, Firefox)

### Out of Scope

- Third-party services and APIs we consume
- Social engineering attacks
- Denial of service attacks
- Issues in dependencies (report these upstream, but let us know too)

## Security Best Practices for Self-Hosters

If you are self-hosting WorldPulse:

- Always run behind a reverse proxy with TLS
- Rotate your `JWT_SECRET` and database credentials regularly
- Keep your `.env.prod` file out of version control
- Use the latest Docker images
- Enable PostgreSQL SSL for remote connections
- Restrict Redis access to localhost or use authentication

## Disclosure Policy

We follow coordinated disclosure. We ask that you give us reasonable time to fix
issues before making them public. We will credit all reporters in our security
advisories unless anonymity is requested.
