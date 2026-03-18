# Contributing to WorldPulse

Thank you for helping build the world's most reliable open-source news network. Every contribution matters.

## Code of Conduct

WorldPulse is committed to being a welcoming, respectful community. Be kind, be constructive, assume good faith.

## How to Contribute

### Reporting Bugs
Open a GitHub issue with:
- A clear, descriptive title
- Steps to reproduce
- Expected vs actual behavior
- Logs / screenshots if relevant
- Your environment (OS, Node.js version, etc.)

### Suggesting Features
Open a GitHub Discussion in the "Ideas" category. Describe:
- The problem you're solving
- Your proposed solution
- Alternatives you've considered
- Who this helps

### Submitting Code

1. **Fork** the repository
2. **Create a branch**: `git checkout -b feat/your-feature` or `fix/your-bug`
3. **Make your changes** following the conventions below
4. **Write tests** for new functionality
5. **Run the test suite**: `pnpm test`
6. **Commit** using conventional commits (see below)
7. **Push** and open a Pull Request

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat:     New feature
fix:      Bug fix
docs:     Documentation change
refactor: Code change that neither fixes a bug nor adds a feature
test:     Adding or fixing tests
chore:    Build process, dependency updates
perf:     Performance improvement
```

Examples:
```
feat(scraper): add USGS earthquake RSS feed
fix(api): correct reliability score calculation for single-source signals
docs: update self-hosting guide for Kubernetes
```

## Development Priorities

### High Priority
- Scraper improvements (new sources, better dedup)
- Verification engine accuracy
- Performance (feed load time < 200ms)
- Accessibility (WCAG AA compliance)
- Internationalization (i18n)

### Medium Priority
- New UI features
- Analytics/dashboard
- Mobile app improvements
- Search relevance tuning

### Good First Issues
Look for issues tagged `good-first-issue` — these are well-scoped, well-documented, and ideal for first contributions.

## Source Contributions

One of the most valuable contributions is adding new verified data sources.

To propose a new source, open a PR modifying `infrastructure/docker/postgres/init.sql` with:
```sql
INSERT INTO sources (slug, name, url, tier, trust_score, language, country, categories, rss_feeds)
VALUES ('source-slug', 'Source Name', 'https://source.example.com', 'regional', 0.80, 'en', 'XX', '{breaking}', '{https://source.example.com/rss}');
```

Source requirements:
- Must have a public, stable RSS or API feed
- Must be a legitimate news organization or official body
- Trust score guidelines:
  - `0.95+`: Major international wire services (AP, Reuters, AFP)
  - `0.90–0.94`: Major national broadcasters (BBC, NPR, NHK)
  - `0.85–0.89`: Quality national newspapers
  - `0.80–0.84`: Regional outlets with editorial standards
  - `0.70–0.79`: Community/local outlets, blogs with strong standards

## Architecture Decisions

Major architecture changes require an RFC (Request for Comments):
1. Open a GitHub Discussion titled "RFC: [Your Proposal]"
2. Describe the change, motivation, and trade-offs
3. Allow 2 weeks for community feedback
4. Maintainer review and merge/reject decision

## Testing

```bash
# Run all tests
pnpm test

# Run specific package tests
pnpm --filter @worldpulse/api test

# Run with coverage
pnpm --filter @worldpulse/api test:coverage
```

Test requirements:
- All new API routes must have integration tests
- All new pipeline functions must have unit tests
- Target: 80%+ coverage on new code

## Questions?

- **Discord**: [discord.gg/worldpulse](https://discord.gg/worldpulse)
- **GitHub Discussions**: For design questions and proposals
- **Issues**: For bugs and specific feature requests

Thank you for contributing to a more informed world. 🌍
