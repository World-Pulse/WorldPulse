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
Open an issue with the feature request form. Describe:
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

### Good places to start
- A new source (see below): one entry and a test
- A bug you hit yourself, with steps to reproduce it
- Tests for code that has none

## Source Contributions

One of the most valuable contributions is a new source. News feeds live in `apps/scraper/src/sources/news-rss.ts` (`NEWS_SOURCE_REGISTRY`): propose one with the "New Intelligence Source" issue form, or open a PR that adds an entry at the end of the registry, in the same format as the others (id, name, feed URL, category, bias label, reliability, home country and point, tags, language).

Source requirements:
- A public RSS or Atom feed that answers the poller's own request (User-Agent `WorldPulse/1.0 (open-source global intelligence; https://world-pulse.io)`), with items from the last few days, each with a title, a link and a date
- A news organization or an official body; not a site that mostly reposts other outlets' stories (a repost would count as a second outlet)
- Terms that allow showing a headline, a short summary and a link (that is all WorldPulse keeps)
- Not already in the registry (one entry per feed address)

Reliability guidelines (0–1):
- `0.90+`: wire services, national broadcasters, central banks and international bodies' own records
- `0.80–0.89`: quality national and regional outlets with editorial standards
- `0.70–0.79`: local outlets and specialist sites with clear standards
- below `0.60`: state-controlled media (also labelled `state-media`)

## Architecture Decisions

Major architecture changes require an RFC (Request for Comments):
1. Open an issue titled "RFC: [Your Proposal]"
2. Describe the change, motivation, and trade-offs
3. Allow 2 weeks for community feedback
4. Maintainer review and merge/reject decision

## Testing

```bash
# Run all tests
pnpm test

# Run one app's tests
pnpm --filter @worldpulse/api test
pnpm --filter @worldpulse/scraper test
pnpm --filter @worldpulse/web test
```

Test requirements:
- All new API routes must have integration tests
- All new pipeline functions must have unit tests
- Target: 80%+ coverage on new code

## Questions?

- **Issues**: for bugs, feature requests, new sources and design questions

Thank you for contributing to a more informed world. 🌍
