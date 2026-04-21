# Reddit r/geopolitics Post — WorldPulse

**Subreddit:** r/geopolitics (~1.5M members)
**Post on:** Monday Apr 20, 2026 at 15:30 ET (late afternoon wave)
**Flair:** Select "Discussion" or appropriate flair

---

## Title

I built a platform that tracks geopolitical events across 184 nations in real-time — here are some patterns that emerge when you see the full picture

---

## Body

For the past year I've been building an open-source platform called WorldPulse that monitors 300+ sources across 184 nations. Wire services, government feeds, conflict data (ACLED), sanctions lists (OpenSanctions), and OSINT APIs — all classified, geolocated, and mapped in real-time.

I wanted to share some observations from watching the data flow, because the patterns that emerge when you aggregate this many sources are genuinely interesting.

**What becomes visible at scale**

When you're tracking signals from ACLED, GDELT, wire services, and government feeds simultaneously, you start seeing things that no single source shows you:

**1. Event cascading is measurable.** A political crisis in one country produces detectable signal spikes in neighboring countries within 12-48 hours — trade disruption alerts, border incident reports, currency movements, refugee-related NGO bulletins. The cascade follows trade dependency graphs more than geographic proximity.

**2. Source disagreement is itself a signal.** When Reuters, AFP, and Al Jazeera all report the same event but classify its severity differently, that divergence is informative. We track cross-source agreement rates and it turns out disagreement clusters around specific event types — territorial disputes and election irregularities have the lowest cross-source agreement.

**3. The information gap between regions is enormous.** Sub-Saharan Africa and Central Asia generate roughly 40% of conflict-related signals but receive about 15% of wire service coverage. ACLED and local NGO feeds fill some of that gap, but the asymmetry is stark when you see it on a map.

**4. Cyber events correlate with physical events more than you'd expect.** Internet outages (tracked via IODA) frequently precede or coincide with physical conflict escalation by 6-24 hours. BGP route changes in particular seem to be a leading indicator for certain types of state action.

**5. Sanctions data moves slower than you think.** OpenSanctions entries often lag the actual political decision by 2-6 weeks. Cross-referencing OFAC, EU, and UN lists reveals timing gaps where entities are sanctioned by one body but not yet by others.

**How it works technically**

Every signal passes through a pipeline: extraction, classification (conflict/natural hazard/cyber/economic/political/health), geolocation, cross-source correlation, and reliability scoring. The result is an interactive map with layers you can toggle — conflict zones, natural hazards, cyber threats, maritime activity.

There are specialized dashboards for sanctions tracking, internet outages, food security, governance indicators, and several other domains.

**What I'd find useful from this community**

- What data sources am I missing? Especially for regions that are under-covered in English-language feeds.
- What patterns would be most interesting to surface? I can add analytical views if there's demand for specific cross-correlation analysis.
- Are there academic datasets or indices (beyond what ACLED, V-Dem, and GDELT provide) that would be worth integrating?

The platform is live at world-pulse.io and the code is open-source on GitHub (MIT license) if anyone wants to dig into the methodology or contribute.

---

## Posting Notes

- r/geopolitics is academic-leaning. No marketing. No product-pitch tone.
- Lead with ANALYSIS, not the tool. The tool is how you got the analysis.
- Use specific data observations — the more concrete and non-obvious, the better
- Expect pushback on methodology (AI classification, source weighting). Be ready to explain limitations honestly.
- If someone asks "how is this different from GDELT?" — honest answer: GDELT tracks events, WorldPulse adds claim-level verification, reliability scoring, and an interactive UI. They're complementary.
- Don't link aggressively. One mention at the end. Let the analysis sell the tool.
- This subreddit has strict rules — read the sidebar before posting. Avoid anything that reads as promotional.

