# Design Critique — world-pulse.io

**Date:** 2026-04-16 (T-4 days to launch)
**Scope:** 51 app routes across `apps/web/src/app/`. Critique is against WCAG 2.1 AA + common conversion heuristics + launch-readiness hygiene.
**Method:** Static review of routing, component inventory, and global styles. Not a live-site click-through (SSH to prod unavailable from sandbox). Treat as a senior design review from the code, to be ground-truthed by a 15-minute click-through on Friday.

---

## TL;DR — the 10 things that matter before launch

In order of impact. Numbers 1–4 are ship-today blockers for conversion quality, not shipping.

1. **Landing page hero — is it the graph explorer?** The graph explorer is the unique differentiator. It must be the hero image/video on `/` (page.tsx). If the hero is a generic world map or signal feed, the first impression defaults to "this is another news aggregator."
2. **51 routes is a lot.** The launch-day nav should surface 6 at most. Cut everything else to a secondary nav, footer, or `/explore` hub. Too many entry points dilutes every single one.
3. **Empty states.** Every page that fetches from a possibly-rate-limited upstream needs a non-empty default. The sanctions seed fallback proves this works; audit the other 14 intel pages for the same pattern.
4. **Mobile hero + nav.** Launch traffic from Twitter/LinkedIn will be 50%+ mobile. Verify the hero, sign-up CTA, and graph explorer CTA all work thumb-first.
5. **One primary CTA per page.** Right now the site seems to offer many (signup, docs, API, self-host, newsletter). Pick one per page and make the others secondary.
6. **Loading states.** The Full Graph Explorer hits `/api/v1/knowledge-graph/entities/top` — confirm it has a skeleton, not a spinner-on-blank.
7. **Performance budget.** Hero page should be LCP < 2.5s on 4G. Verify before launch. Graph explorer separately — LCP < 3.5s is acceptable given canvas-rendered content.
8. **Color contrast.** Amber (#f5a623) on dark (#06070d) passes AA for large text; verify small-text usage (12–14px) is not using amber-on-dark.
9. **404 / error pages.** `/not-found.tsx`, `/error.tsx`, `/global-error.tsx` exist — verify their copy is on-brand (see brand guidelines) and includes a path forward, not just "something went wrong."
10. **SEO basics.** Every top-level page should have a unique `<title>`, meta description, and Open Graph image. Currently likely inherited from a layout — audit.

---

## Section 1 — Information architecture

The app has **51 top-level routes**. That's a lot of intel verticals for a product in soft launch. Routes identified:

Primary intel (launch-day-visible): `/`, `/signals`, `/signals/[id]`, `/sanctions`, `/claims`, `/briefing`, `/briefings`, `/knowledge-graph`, `/knowledge-graph/explorer`, `/search`, `/developers`, `/api`, `/pricing`, `/map`

Secondary intel (niche but real): `/cyber-threats`, `/digital-rights`, `/finance`, `/food-security`, `/governance`, `/internet-outages`, `/labor-rights`, `/patents`, `/space-weather`, `/undersea-cables`, `/water-security`, `/live-cameras`, `/cameras`, `/clusters`, `/communities`, `/countries`

Product infrastructure: `/admin`, `/ai-infrastructure`, `/alerts`, `/analytics`, `/auth`, `/onboarding`, `/settings`, `/sources`, `/status`, `/users`, `/posts`, `/embed`, `/audio-claims`, `/video-claims`, `/docs`, `/explore`

**Recommendation:** Introduce a three-tier IA:

- **Tier 1 (nav):** Home, Signals, Graph Explorer, Claims, Sanctions, Developers, Pricing — 7 items max.
- **Tier 2 (under "Intel" mega-menu or on `/explore`):** All 20+ vertical intel pages.
- **Tier 3 (footer):** Everything else.

Cutting the navigation surface on launch day will measurably improve CTR to the features we want to be known for.

---

## Section 2 — Landing page (`page.tsx`)

**Hypothesis (unconfirmed from code alone):** the landing currently leads with a generic live-signal feed.

**Launch-worthy structure (recommended):**

1. **Hero:** One sentence positioning + graph explorer screenshot or 15-sec loop video. Primary CTA: "Explore the graph" → `/knowledge-graph/explorer`. Secondary: "Read the docs" → `/developers`.
2. **Proof block:** Live counters — "X signals ingested today / Y claims verified / Z sources / N locales." Hit the public API for the counters; cache 5 min.
3. **Three-up feature strip:** "Graph Explorer" | "Claim Verification" | "Developer SDK" — each 50 words, each linked.
4. **Differentiator row:** MIT-licensed, self-hostable, 700+ sources, 10 locales — as a row of labels with icons.
5. **Competitor comparison (optional but valuable):** Small 4-row table comparing to Factiverse/GDELT/WorldMonitor on open-source, graph, API. If you can't do it tactfully, skip it.
6. **Code block:** `pnpm install @worldpulse/sdk` + three-line example. Conversion gold for the developer audience.
7. **Footer CTA:** "Star us on GitHub" + GitHub stars counter.

**Anti-pattern to avoid:** A landing page that tries to showcase all 28 intel verticals above the fold. That's what `/explore` is for.

---

## Section 3 — The Full Graph Explorer (`/knowledge-graph/explorer`)

This is our unique weapon. No direct competitor has an interactive KG explorer. Every single one of these must be right on launch day:

- **Cold load** < 3.5s LCP. Skeleton state with a "loading 10M nodes..." progress message beats a spinner.
- **First interaction** is obvious. A tooltip on the first hover ("Drag to pan, scroll to zoom, click a node for details") that dismisses on first drag.
- **Node labels** must be legible at default zoom. If the KG is dense, consider ego-network mode on first load — show just the top 20 entities + their 1-hop neighborhoods.
- **Empty state** if the KG API returns 0 entities — show a seed graph of 50 high-interest entities (similar pattern to the sanctions seed fallback).
- **Mobile.** Force-directed graphs are painful on mobile. At small viewports, fall back to a card-based list view with an expand-to-fullscreen button.
- **Share.** A "copy link to this view" button that URL-encodes the current node selection + zoom. This is what gets the graph onto Twitter.
- **Performance cap.** If node count > 500 visible, skip labels on zoom-out; render labels only for the hovered node + top 20 by mention count.
- **Accessibility.** Canvas is inherently screen-reader-hostile. Provide a fallback table view at `?view=table` that lists entities + their top relationships. Link from an "Accessible view" footer.

---

## Section 4 — Signal feed (`/signals`, `/signals/[id]`)

The signal detail pages were the April 15 bug — they now work. Beyond that:

- **Density.** A signal card should show: title, source (with reliability score badge), timestamp, 1-2 line excerpt, entity tags (max 3 visible, "+N more" chip), related claims count. If you can't fit that in ~180px of vertical space, the card is overdesigned.
- **Source badge.** Reliability score rendered as a 0–100 chip, color-coded (< 50 red, 50–75 amber, 75+ green). Hover shows the score breakdown.
- **Filter drawer** on the right. Default collapsed. Filter by: source country, reliability score, category, entity, time window.
- **Infinite scroll vs pagination.** Infinite scroll on the main feed is fine if you cap at 200 items and show a "load more" prompt after. Pagination for filtered views where state matters.
- **"Live" indicator.** The pulse on the brand icon ties the "pulse" metaphor to "live updates." Use it on the feed header when new signals are appearing.

---

## Section 5 — Sanctions page (`/sanctions`)

Just fixed (Apr 16). Design principles from here:

- Threat-level badges (critical/high/medium/low) need sufficient contrast; "low" threat should not be gray-on-gray.
- Card grid density. 14 seed entities render as a 4x4 grid on desktop, 2x7 on tablet, 1x14 on mobile. Current implementation should be verified.
- Empty state is never shown (seed guarantees content). Good.
- Link to the single-entity detail page needs to exist — currently unclear from code if `/sanctions/[id]` route exists.

---

## Section 6 — Developer surfaces (`/developers`, `/api`, `/docs`)

Developers decide in 20 seconds. Optimize accordingly.

- **First fold of `/developers`** should show a working code snippet. Not a sign-up form.
- **API key generation** — once signed in, the key should be one click, visible immediately, with a prominent "copy to clipboard." No email confirmation loops for a free-tier key.
- **`/api` as the OpenAPI explorer** — interactive, with a "try it" button that actually runs with a sample key.
- **Rate limit display** per endpoint. Developers should see "200 req/min, 200k/month free tier" without digging.
- **SDK docs** — TypeScript examples, with types visible. We're a TS-first stack; lean into it.

---

## Section 7 — Error + empty states

From the layout.tsx review, PostHog is wired but requires `NEXT_PUBLIC_POSTHOG_KEY`. That's orthogonal to this section but worth noting: **we need analytics on launch day or we're flying blind.**

**Error states audit:**

- `/not-found.tsx` exists — verify copy is not "Sorry, this page could not be found." Should be: "Signal not found. It may have been retracted, or the URL may be wrong. [See latest signals](/signals)."
- `/error.tsx` — catches render errors. Copy should acknowledge the issue, surface an incident ID, link to `/status`.
- `/global-error.tsx` — last-resort page. One sentence, one CTA ("Back to home"), no marketing.
- Page-level empty states — audit each intel vertical (food-security, water-security, etc.) for what shows when the scraper hasn't ingested any signals in that category yet.

---

## Section 8 — Accessibility spot-check (WCAG 2.1 AA)

Can't run an automated audit from the sandbox, but high-probability findings given the stack:

- **Color contrast:** Amber on near-black usually passes for large text (>24px). Audit any 14px amber-on-dark label — likely fails.
- **Keyboard navigation:** Force-directed graph is a known accessibility landmine. Provide `?view=table` fallback (noted above).
- **Screen-reader labels:** Monospaced IDs (UUIDs, timestamps) should have readable aria-labels — e.g., `aria-label="Signal 66be8416, reported 2 minutes ago"`.
- **Focus indicators:** Glassmorphism surfaces often lose visible focus rings. Verify focus states are 3:1 contrast minimum.
- **Motion:** If the "pulse" animation on the brand icon runs continuously, respect `prefers-reduced-motion`.
- **Alt text:** Every graph explorer node screenshot needs alt text in docs/blog posts (the Canvas itself is addressed by the table fallback).

---

## Section 9 — Performance budget

Before launch, verify:

| Page | Metric | Target |
|---|---|---|
| `/` | LCP | < 2.5s (4G) |
| `/` | CLS | < 0.1 |
| `/` | Total JS | < 300 KB gzipped |
| `/signals` | LCP | < 3.0s |
| `/knowledge-graph/explorer` | LCP | < 3.5s |
| `/developers` | LCP | < 2.0s (text-heavy, no excuses) |

Run Lighthouse on staging Friday. Record scores. Fix anything in the red.

---

## Section 10 — 15-minute Friday click-through checklist

A designer (or any fresh pair of eyes) should spend 15 minutes on Friday Apr 17 running this list:

1. Land on `/`. Did I understand what WorldPulse is in 5 seconds?
2. Click the primary CTA. Did it take me somewhere useful?
3. Open `/knowledge-graph/explorer`. Did it load in under 4 seconds? Did I understand what I was looking at?
4. Open a signal detail page. Is the source cited clearly?
5. Open `/sanctions`. Does it show 14 entities? Are the threat levels readable?
6. Open `/developers`. Can I copy a working code snippet in the first 10 seconds?
7. Try to sign up. Did it work? Did I get an API key?
8. Open DevTools → Network. Any 500s? Any requests > 3s?
9. Test on mobile (real device or iOS/Android emulator). Is the nav usable? Is the hero legible?
10. Intentionally try to break something — unicode in a search query, enormous entity ID in a URL, etc. Does the error state look acceptable?

Anything that fails: file an issue, tag `launch-blocker`, fix by Sunday.

---

## Deferred (post-launch)

These are real but non-blocking:

- A proper design system audit (tokens, spacing scale, component variants).
- A heuristic walk-through of all 28 intel vertical pages (we launch with the top 5; the rest are "yes it exists" discoverable via `/explore`).
- Visual regression testing on the graph explorer.
- Empty-state illustrations (currently text-only, which is on-brand but could be warmer).
- A full accessibility audit with axe + screen reader.
- Animations pass — does "pulse" actually pulse?
