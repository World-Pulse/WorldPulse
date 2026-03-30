---
name: code-review
description: Review code changes for security, performance, and correctness. Trigger with a PR URL or diff, "review this before I merge", "is this code safe?", "what do you think of this code?", or when checking a change for N+1 queries, injection risks, missing edge cases, auth bypasses, or error handling gaps. Also trigger when someone shares a file or snippet and asks for feedback, wants a second opinion, or says anything like "take a look at this". Don't wait for the word "review" — if they're sharing code and want feedback, use this skill.
---

# /code-review

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../../CONNECTORS.md).

Review code changes with a structured lens on security, performance, correctness, and maintainability.

## Usage

```
/code-review <PR URL or file path>
```

Review the provided code changes: @$1

If no specific file or URL is provided, ask what to review.

## How It Works

**Standalone** (always works): paste a diff, share a file path, or drop in a PR URL.

**With connected tools**:
- Source control → pull PR diff automatically, check CI status
- Project tracker → link critical findings to open tickets; verify the PR addresses its stated requirements
- Knowledge base → validate against team coding standards

## Review Process

Start by understanding the *purpose* of the change before critiquing it. A pattern that looks odd in isolation often makes sense in context. Read the PR description, inline comments, and any referenced tickets before flagging style issues.

Then review across four dimensions:

### Security

Look for the full OWASP Top 10, with extra attention to the patterns that surface most often in modern web backends:
- SQL/NoSQL injection — especially raw query construction, template literals in queries
- Auth bypass — missing middleware, wrong route ordering, JWT payload read before signature verification
- Secrets or credentials hardcoded or written to logs
- Mass assignment / over-permissive object spread (`...req.body` directly into DB)
- SSRF — user-controlled URLs fetched server-side without allowlisting
- Path traversal — user input used in `fs` operations or file paths
- Unvalidated redirects
- Prototype pollution (Node.js) — `Object.assign({}, userInput)`
- Rate limiting absent on auth, signup, or sensitive mutation endpoints

TypeScript-specific: `as any` casts that silently discard input validation, unhandled promise rejections swallowed with empty `catch(() => {})`.

### Performance

- N+1 queries: a DB call inside a loop is almost always N+1. Look for `await` inside `for`/`forEach`.
- Missing indexes: new `WHERE` or `ORDER BY` columns that don't have a corresponding index
- Unbounded queries: no `LIMIT` clause on queries that could return large result sets
- Unnecessary serialization in hot paths: `JSON.parse/stringify` called on every request
- Missing cache: identical expensive queries repeated within the same request lifecycle
- Memory leaks: event listeners added but never removed, large closures captured in long-lived contexts

### Correctness

- Edge cases: empty array/string, `null`/`undefined`, `0` treated as falsy, negative numbers
- Error propagation: swallowed errors are silent bugs waiting to happen — `catch(() => {})` is a red flag
- Async correctness: missing `await`, floating promises, race conditions in concurrent operations
- Off-by-one: pagination math, array slicing, inclusive vs exclusive date ranges
- Type coercion: `==` vs `===`, `Number("")` === `0`, `Boolean("false")` === `true`
- Idempotency: if this code runs twice (retry, double-click, duplicate webhook), does it break?

### Maintainability

- Naming: is it obvious what this does without reading the implementation?
- Single responsibility: does this function do one thing?
- Duplication: is this logic already handled elsewhere in the codebase?
- Test coverage: are the important edge cases tested, or just the happy path?
- Comments: non-obvious logic deserves an explanation, not just a description of what it does

## Output Format

Lead with the verdict so the author knows immediately where they stand. Show findings from most to least severe.

```markdown
## Code Review: [PR title or file]

**Verdict**: ✅ Approve / ⚠️ Approve with suggestions / 🔴 Request changes

### Summary
[1-2 sentences: what does this change do, and is it sound?]

### 🔴 Must Fix
[Only include if there are blocking issues — omit this section if none]
| File | Line | Issue | Why it matters |
|------|------|-------|----------------|
| auth.ts | 42 | JWT signature not verified before payload use | Allows forged tokens |

### 🟡 Should Fix
| File | Line | Issue | Category |
|------|------|-------|----------|
| feed.ts | 88 | `await` inside `forEach` — N+1 query | Performance |

### 💡 Consider
[Minor suggestions, style, optional improvements — prose is fine here]

### ✅ What's Good
[Be specific. "Looks good" is not useful. "Error handling on the Redis timeout is solid" is.]
```

**Severity guide:**
- 🔴 Must Fix: security vulnerabilities, data corruption risk, breaking existing behavior
- 🟡 Should Fix: performance problems, unhandled errors, missing edge cases likely to appear in production
- 💡 Consider: style improvements, small refactors, things that are fine but could be better

## Tips

1. **Give context** — "This is in the hot path" or "This touches PII" changes the review focus.
2. **Specify concerns** — "Focus on security" or "Is the caching logic right?" saves time.
3. **Include tests** — Test code gets reviewed too: missing coverage and weak assertions are findings.
4. **For large diffs** — Describe what changed at a high level; I'll work through it systematically.
