# WorldPulse Brand Voice Guidelines

**Version:** 1.0 (synthesized from existing source material 2026-04-16)
**Status:** Living document. Revise after launch week feedback.
**Use:** Blog posts, landing page, error messages, tweets, investor/partner pitches, press materials.

---

## One-line brand promise

> Verified real-time intelligence — open-source, auditable, and free for developers to build on.

---

## Voice in three words

**Verified. Unafraid. Real.**

- **Verified** — every claim about the product ties to something measurable: 700+ sources, reliability scores, 10 locales, MIT license. No adjectives without numbers.
- **Unafraid** — says the hard true thing. Names competitors. Admits tradeoffs. Doesn't hedge.
- **Real** — ships, measures, iterates. No vision decks, no roadmap slides. What's live is what we talk about.

---

## Who we're writing for

**Primary:** Developers, analysts, journalists, OSINT practitioners.
**Secondary:** Institutional buyers — newsrooms, NGOs, compliance teams, public-interest researchers.
**Not for:** Consumers browsing for headlines (that's Ground News). Marketing-first audiences who want SaaS vibes. Skeptics of open source.

The reader has already read five other tools' landing pages this month. Assume they're technical, time-poor, and allergic to puffery.

---

## Register

**Reuters meets GitHub.**

Wire-service precision — specific verbs, concrete nouns, short sentences. Open-source transparency — honest about what works and what doesn't. No consumer-facing emotion; no B2B-SaaS fog.

Think: "The scraper ingests 700+ RSS feeds every 90 seconds. Each signal is classified, entity-tagged, and correlated against related signals in a knowledge graph."

Don't think: "Unlock powerful insights with our AI-powered intelligence platform."

---

## Word bank — use these

Repeat these across surfaces so they accrue meaning. Verbs and nouns, not adjectives.

**Core nouns**
- signal (not "event," not "item")
- claim (not "statement")
- source (not "feed" when it's the entity; "feed" when it's the mechanism)
- intelligence (not "insights," not "data")
- knowledge graph (not "relationships," not "connections")
- pulse (the brand metaphor — use sparingly, with intent)

**Core verbs**
- verify / cross-check (not "validate")
- enrich (the signal enrichment pipeline is 5 layers)
- correlate (signals → events, claims → sources)
- extract (claims from text/audio/video)
- ingest (sources into signals)

**Core adjectives (sparingly)**
- real-time (when it's true — which it is)
- open-source / MIT-licensed (say MIT when license matters)
- verified (never without evidence)
- self-hostable (one word, no dash)
- reliability score (not "trust score," not "credibility rating")

**Numbers we can cite**
- 700+ sources
- 10 locales
- 5-layer enrichment pipeline
- 8 claim types (factual, statistical, attribution, causal, predictive, visual, chyron, opinion)
- 12 languages (claim extraction)
- MIT license
- 90-second ingest cadence

---

## Phrases to reuse verbatim

These already appear across the codebase and should stay consistent:

1. "The open-source global intelligence network."
2. "Real-time signals from [N]+ global sources, verified and cross-checked."
3. "Reliability scores on every piece of content."
4. "Verified, enriched intelligence — not raw data dumps."
5. "Between wire-service quality and open-source flexibility."
6. "No investors. No ad revenue. No data sales. Just the world, in real time."
7. "Self-hostable in 15 minutes."
8. "Free, forever, MIT-licensed."

---

## Phrases to kill on sight

Every one of these is either a SaaS cliché or a hedge. If a draft contains these, rewrite.

- "Leverage," "empower," "unlock," "supercharge"
- "AI-powered" — we use AI; we don't need to brand ourselves with it
- "Cutting-edge," "next-generation," "bleeding-edge," "industry-leading"
- "Seamless," "frictionless," "intuitive"
- "Game-changer," "paradigm shift," "revolutionize"
- "Best-in-class," "world-class," "enterprise-grade"
- "Turnkey solution"
- "Data-driven" (without saying what data)
- "Insights" (say "claims," "signals," "verifications," or don't say it)
- "Reimagine," "transform the way"
- "Trusted by" (without naming who)

---

## Formatting conventions

**Headlines**
- Sentence case for most, Title Case only for the brand name and product names (e.g., "Full Graph Explorer").
- No periods in headlines.
- One colon maximum.

**Numbers**
- Always use digits for cardinal numbers > 10 ("700+ sources," not "seven hundred-plus sources").
- Use "+" for open-ended ranges, not "over" or "more than" ("700+" not "over 700").
- Whole numbers for counts; one decimal for percentages.

**Product names**
- **WorldPulse** — one word, capital W, capital P.
- **Full Graph Explorer** — title case, proper noun.
- **Signal** — capitalized only when referring to the schema ("a Signal object"); lowercase otherwise.

**Code and CLI**
- Always monospace in docs: `pnpm install @worldpulse/sdk`.
- Never suggest commands that require root unless necessary and flagged.
- Prefer `pnpm` over `npm` (we're a pnpm shop).

---

## Tone by surface

### Landing page

Short. Specific. Image-heavy. The hero is a value prop + the graph explorer screenshot. Three sections max above the fold: what it is, who it's for, a single CTA.

*Example hero:*
> The open-source global intelligence network.
> Real-time signals from 700+ sources. Verified claims. A public knowledge graph.
> MIT-licensed. Self-hostable. Built for developers.

### Documentation

Procedural. Numbered. No marketing copy. Assume the reader is copy-pasting commands. Every example must actually run.

*Example:*
> To verify a claim:
> ```
> import { WorldPulse } from '@worldpulse/sdk'
> const wp = new WorldPulse({ apiKey: process.env.WP_KEY })
> const result = await wp.claims.verify('The moon landing was staged')
> ```
> Returns a reliability score (0–1) and a list of cross-checking sources.

### Error messages + empty states

Direct. Actionable. No apologies unless it's actually our fault. No emoji.

*Good:*
> "Too many requests. Slow down."
> "Couldn't find that signal — it may have been retracted."
> "Source unavailable. Try again in a minute."

*Bad:*
> "Oops! Something went wrong 😕"
> "We're having trouble right now. Please try again later."

### Social (Twitter/X, LinkedIn)

Twitter: each tweet one atomic fact + one screenshot. No emoji threads. Reply substantively, not performatively.

LinkedIn: founder voice. Long-form OK. Lead with a number or a concrete example. Never "I'm thrilled to announce."

### Blog posts

Inverted pyramid — most important fact in the first sentence. Subheads are statements, not questions. Code blocks with context, never naked. Screenshot of the product at least once per post.

### Press / outreach

Three paragraphs. Paragraph 1: what. Paragraph 2: why it's different. Paragraph 3: what the reader can do with it today. No attachments over 2MB.

---

## Visual identity (synthesized from `globals.css`)

**Primary palette**
- `#06070d` — near-black background (not pure black; slight blue warmth)
- `#f5a623` — amber (primary action, brand accent)
- `#00d4ff` — cyan (secondary / tech accent)
- `#00e676` — verified green
- `#ff3b5c` — breaking / critical red

**Typography**
- Display: **Bebas Neue** — wire-service all-caps for titles and hero
- Monospace: **JetBrains Mono** — code, endpoints, IDs, timestamps
- Body: system sans-serif stack

**Visual register**
- High contrast, dark-mode default
- Glass surfaces, no drop shadows
- Grid layouts (map, signals table)
- Monospace for data (endpoints, UUIDs, timestamps, counts)
- Sparse emoji — used as micro-taxonomy only (🛰️ signals, 🔍 search, 🗺️ map)

---

## Positioning lines by audience

### For developers
> Install the SDK. Call the API. Get verified claims. MIT-licensed. Self-hostable. No rate-limit surprises.

### For journalists
> Every claim gets a reliability score. Every source is visible. The full graph of who said what is public and auditable.

### For researchers / NGOs
> Self-hostable on a $20/mo VPS. No procurement cycle. Export to CSV, JSON, or your SQL database. MIT license — modify and redistribute.

### For open-source community
> No investors. No ad revenue. No data sales. MIT-licensed forever. Contributions welcome.

---

## Founder voice (first-person communications)

When the founder writes a blog post, tweet thread, or investor/partner note:

- Use "I" and "we" — "I" for opinion, "we" for product/company.
- Admit what's not working. "The scraper died three times in the first month. Here's what we learned."
- Name competitors. Never disparage them. Always cite what they do well.
- Tie every claim back to something measurable. "We went from 108 to 700 sources in 14 days" — not "we've scaled rapidly."

---

## Samples

### On-brand ✅

> "WorldPulse ingests 700+ RSS feeds every 90 seconds. Each signal is entity-tagged, cross-checked against related signals, and scored for reliability. The full knowledge graph is public at `/knowledge-graph/explorer`. Self-hosting takes 15 minutes on a $20 VPS. MIT license."

### Off-brand ❌

> "WorldPulse is a cutting-edge, AI-powered global intelligence platform that empowers journalists and developers to unlock the transformative power of real-time news data. With best-in-class reliability scoring and a seamless, intuitive interface, WorldPulse is reimagining how the world discovers truth."

(Every phrase in the second sample violates at least one rule above.)

---

## Review checklist before publishing

Before hitting publish on any outbound content, read it against these six questions:

1. Is every adjective earned by a number or an example?
2. Does it name a competitor (or explicitly choose not to)?
3. Could a developer `curl` the thing I'm describing right now?
4. Is there a specific action the reader can take in the next 60 seconds?
5. Did I use any word from the kill list above?
6. Would I show this to a hostile HN commenter without wincing?

If any answer is "no" or "yes to #5," rewrite.
