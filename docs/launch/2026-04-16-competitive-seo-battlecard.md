# Competitive Landscape + SEO Angle — WorldPulse

**Date:** 2026-04-16 (T-4 days to launch)
**Use:** Sales battlecard, content strategy, positioning reference, press kit appendix

---

## Executive summary

WorldPulse is the only open-source, developer-first platform that combines real-time signal ingest (700+ sources), multi-modal claim verification (text + audio + video), and an interactive knowledge graph — under an MIT license with self-hosting. Every single one of the nine major competitors wins on exactly one axis; WorldPulse wins the intersection.

The wedge is not "better fact-checking." The wedge is "open-source fact-checking + knowledge graph + developer SDK, in one."

---

## Threat matrix

| Competitor | Threat | One-line | We win on | They win on |
|---|---|---|---|---|
| **Factiverse** | HIGH | Enterprise real-time fact-checking for live audio/video | Open-source, developer SDK, public KG | Live broadcast speed, 300K fact-check DB |
| **GDELT Project** | HIGH | Academic global event DB, 100+ languages, TV archive | Claim-level analysis, bias detection, KG UX | Institutional depth, 1979-present history |
| **WorldMonitor** | HIGH | AGPL-3.0 real-time dashboard, 435 feeds, 3D globe | MIT (commercial-safe), claim pipeline, API | 3D globe UI, local Ollama, 46K GitHub stars |
| **Ground News** | MED | Consumer app, 50K+ sources, bias ratings | Developer platform, self-hostable, claim-level | Consumer polish, AllSides/MBFC partnerships |
| **Danti** | MED | Enterprise multi-modal OSINT for US gov | Accessibility, open-source, price | Geospatial fusion, $7.8M funding, Space Force contract |
| **Crucix** | MED-growing | Self-hosted 26-feed OSINT dashboard, LLM alerts | API, SDK, structured data, scale (700 vs 26) | Privacy-first simplicity, zero-cost LLM-agnostic |
| **NewsGuard** | MED | Source-level trust scores for 35K publishers | Claim-level granularity, open ratings | Enterprise relationships, apolitical process |
| **Logically AI** | MED | Narrative threat detection for gov/NGO | Perpetual MIT access, developer SDK | Human-in-the-loop rigor, narrative clustering |
| **Bellingcat** | MED | OSINT publisher + toolkit (not a tool vendor) | Platform/API depth | Methodology reputation, case studies |

---

## Detailed competitor briefs

### Factiverse — `factiverse.ai`
Enterprise SaaS for real-time fact-checking of live audio/video claims. Multi-database verification (Bing, Google, Scholar + 300K-claim DB). Newsroom-focused.

- **Their edge:** Fastest live broadcast fact-checking on the market.
- **Our edge:** They're a black box with a sales cycle. We're `pnpm install @worldpulse/sdk` and a public API. If you want to build fact-checking *into* a product, Factiverse won't let you — we will.

### GDELT Project — `gdeltproject.org`
Academic-grade global event database. 100+ language translingual processing. Entire TV news archive (now Gemini-3.1-indexed). Free on AWS Open Data.

- **Their edge:** Institutional breadth, historical depth from 1979, TV archive.
- **Our edge:** GDELT is events + metadata. We add a claim-extraction pipeline, reliability scoring, bias detection, and an interactive knowledge graph on top. GDELT answers "what happened." We answer "what was claimed, and is it true."

### WorldMonitor — `github.com/koala73/worldmonitor`
The closest open-source peer. AGPL-3.0. 435 feeds. 45 map data layers. 3D globe + 2D map. Cross-signal correlation. Local Ollama, zero cloud dependency.

- **Their edge:** Mature UI, 3D globe, 46K+ stars, totally offline-capable.
- **Our edge:** AGPL-3.0 is a non-starter for commercial builds — we're MIT. They're feed-aggregator-only; we have a full claim pipeline + knowledge graph. They target end users; we target developers with a real SDK and API.

### Ground News — `ground.news`
Consumer-grade news aggregator with bias ratings from AllSides, Ad Fontes, MBFC. 50K+ sources. Freemium → Pro/Premium/Vantage.

- **Their edge:** Best consumer UX in the space, recognized bias taxonomies.
- **Our edge:** Ground News is a destination app. We're infrastructure. Developers can't build on Ground News — they can build on us.

### Danti — `danti.ai`
Federal-agency-facing multi-modal OSINT fusion (imagery + signals + social + news). $7.83M raised, US Space Force contract.

- **Their edge:** Geospatial + SIGINT-adjacent intelligence for classified workflows.
- **Our edge:** Danti requires security clearance and procurement cycles. We're a `git clone` for researchers, NGOs, and journalists who can't wait for a vendor RFP.

### Crucix — `github.com/calesthio/Crucix`
Self-hosted OSINT dashboard. 26 feeds (satellite, flight, radiation, sanctions, markets). LLM alerts via Claude/Gemini. ~15-min update cadence.

- **Their edge:** Privacy-first, zero-cost, LLM-agnostic, 15-minute setup.
- **Our edge:** 26 feeds vs 700+. Dashboard-only vs full API/SDK/GraphQL. Individual vs collaborative. We're what Crucix users graduate to when they need scale.

### NewsGuard — `newsguardtech.com`
Source-level trust ratings for 35,000+ publishers. Trained journalists score each publisher 0-100 across 9 criteria. Enterprise API.

- **Their edge:** Editorial rigor, enterprise relationships, 95%+ engagement coverage.
- **Our edge:** NewsGuard rates the *publisher*. We rate the *claim*. A source can have a 90 NewsGuard score and publish one bad claim — we catch that. Also: they're gated behind enterprise sales; our scores are public.

### Logically AI — `logically.ai`
Misinformation + narrative threat detection for governments/NGOs via HAMLET (human-in-the-loop). Enterprise SaaS.

- **Their edge:** Human review rigor, narrative clustering for state-actor attribution.
- **Our edge:** Logically lost the Meta and TikTok contracts in 2025 — their model depends on a few big customers. Our model is durable because it's MIT. NGOs priced out of Logically can self-host us tomorrow.

### Bellingcat — `bellingcat.com`
Not a software vendor — an investigative OSINT publisher + free online toolkit. Teaches the methods.

- **Their edge:** Brand authority, case studies, community trust.
- **Our edge:** Bellingcat is the textbook. We're the IDE. Complementary, not overlapping — we should partner, not compete.

---

## SEO keyword clusters

Twelve clusters to target, ordered by (winnability × intent-quality × volume):

### Tier 1 — high winnability, high intent

1. **"Open-source fact-checking"** — Currently no dominant owner; Bellingcat ranks for "open-source investigation" but not "fact-checking." Content: "The open-source fact-checking stack" blog + docs landing page.

2. **"Knowledge graph for news"** — GDELT owns "event graph" abstractly but has no UI. We're the only interactive explorer. Content: "How we built a 10M-node knowledge graph from 700 news sources" + live demo on graph explorer page.

3. **"Self-hosted news intelligence"** — Crucix and WorldMonitor are here but don't market aggressively. Content: "Self-host WorldPulse in 15 minutes" + docs + YouTube demo.

4. **"MIT-licensed news API"** — Essentially unclaimed. Content: landing page `/developers/api` + `/pricing` messaging the free forever baseline.

### Tier 2 — competitive but differentiated

5. **"Real-time claim verification"** — Factiverse owns live broadcast; we own the async + multi-modal + open-source angle.

6. **"News fact-check API"** — NewsGuard and Factiverse gate behind enterprise. We have a public tier — say so on every page.

7. **"Global news API" / "News aggregation API"** — NewsAPI.org dominates but is shallow. GDELT is academic. We have better enrichment.

8. **"OSINT platform"** — Bellingcat (publisher) and Crucix (tool) here. Our differentiator is the SDK/API pair.

### Tier 3 — aspirational / brand-building

9. **"Media bias detection"** — Ground News + AllSides dominate consumer; NewsGuard dominates enterprise. We go after developers with the community-corrections angle.

10. **"Misinformation detector"** — Logically + NewsGuard dominate. Our angle is "bias-resistant, community-corrected, open."

11. **"RSS aggregator with AI"** — Feedly owns this commercially. Our angle is "the one with a knowledge graph."

12. **"Geopolitical intelligence"** — GDELT, Danti, WorldMonitor. Crowded. Our angle is accessibility (no clearance, no procurement).

---

## Content marketing angles (owned by WorldPulse)

Five concrete content pieces to write in the first 30 days post-launch:

1. **"Open-Source Intelligence as a Public Good"** — Flagship positioning piece. Frames WorldPulse as the anti-proprietary alternative. Links to NGO case study.

2. **"The Knowledge Graph for News"** — Technical deep-dive + live demo. Our unique differentiator — hammer it. Embed the Full Graph Explorer.

3. **"Build Fact-Checking Into Your App: WorldPulse SDK in 10 Minutes"** — Developer-first tutorial. npm install, first API call, first claim verification, embed widget. This is the top-of-funnel for the developer audience.

4. **"Fact-Checking Without Borders: 10-Locale Claim Pipeline"** — Multilingual angle. Case study: cross-locale signal correlation for a real event.

5. **"Every Claim, Every Source, Fully Auditable"** — Transparency manifesto. MIT license + public graph + no paywall = auditable trust infrastructure. Great for press.

---

## One-page battlecard (for press + sales)

| Capability | **WorldPulse** | Factiverse | GDELT | WorldMonitor | Ground News |
|---|---|---|---|---|---|
| License | **MIT** | Proprietary | Public/academic | AGPL-3.0 | Proprietary |
| Self-hostable | **Yes** | No | Yes (AWS) | Yes (local) | No |
| Real-time claim extraction | **Text / audio / video** | Audio / video | Events only | Feeds only | No |
| Knowledge graph + explorer | **Yes (interactive)** | Citations only | Event network | Feed aggregator | No |
| Developer API | **REST + GraphQL + WS + SDK** | Enterprise API | AWS Marketplace | Local Ollama | None |
| Source count | **700+ + OSINT** | 300K fact-checks | 100+ languages | 435 feeds | 50K |
| Public pricing | **Free tier + Pro** | Enterprise only | Free | Free (AGPL) | Freemium |
| Community corrections | **Yes** | No | No | No | No |
| Mobile + widget + extension | **Yes / Yes / Yes** | No | Limited | No | App only |

---

## Positioning statement (for launch announcement)

> WorldPulse is the open-source global intelligence network. Real-time signals from 700+ sources, multi-modal claim verification (text, audio, video), and an interactive knowledge graph — MIT-licensed, self-hostable, with a developer SDK. Built for the people building the next generation of news tools: journalists, analysts, researchers, and developers who don't want to wait for a sales cycle to verify a claim.

---

## Next steps (content team)

1. Publish the Knowledge Graph deep-dive on Day 1 (highest-differentiation story).
2. Publish the SDK tutorial on Day 2 (top-of-funnel for dev audience).
3. Land one journalist demo before launch — Bellingcat, ProPublica, or ICIJ as the first ask; they're positioning-aligned.
4. Create battlecard card images for each of Factiverse, GDELT, WorldMonitor for social.
5. Set up alerts on competitor launches (GDELT TV, Factiverse Gather updates, WorldMonitor releases).
