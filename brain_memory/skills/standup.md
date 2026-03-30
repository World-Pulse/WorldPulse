---
name: standup
description: Generate a standup update from recent activity. Use when preparing for daily standup, summarizing yesterday's commits and PRs and ticket moves, formatting work into yesterday/today/blockers, or structuring a few rough notes into a shareable update. Also trigger when someone says "help me write my standup", "what did I do yesterday", "I need to post an update", or drops a list of things they worked on and needs it structured. Use this skill proactively whenever the user seems to be preparing a status update, even if they don't say "standup" explicitly.
---

# /standup

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../../CONNECTORS.md).

Generate a standup update by pulling together recent activity from connected tools or user notes.

## How It Works

**If tools are connected**, pull activity automatically before asking the user anything:
- Project tracker → look for tickets moved to "in progress", "in review", or "done" in the last 24 hours
- Source control → recent commits, opened/merged PRs
- Chat → key decisions or threads flagged for follow-up

Then present a draft and ask the user to fill in anything missing — especially what they're planning for today and any blockers.

**If no tools are connected**, ask the user to describe what they worked on. Even a rough dump ("fixed the login bug, reviewed Sarah's PR, got stuck on the billing integration") is enough to produce a clean standup.

## What Makes a Good Standup

A standup exists to help the team, not the individual. The goal is to:
1. Signal what you shipped (so others know it's done)
2. Signal what you're working on next (so others can coordinate)
3. Surface blockers early (so someone can unblock you today, not tomorrow)

Keep it short — 3-5 bullets total. If there's nuance worth sharing, a sentence of context is fine. If it needs more than that, it belongs in a thread or a meeting, not the standup.

## Output Format

```markdown
## Standup — [Day, Date]

**Yesterday**
- [What shipped or progressed — link ticket/PR if available]
- [Another completed item]

**Today**
- [What you're starting or continuing — specific enough to be actionable]
- [Another item]

**Blockers**
- [Describe the blocker, who owns it, and what you need] — or "None"
```

**Formatting guidance:**
- Write in past tense for yesterday, present/future tense for today
- Mention ticket numbers or PR numbers if available — they make the update scannable
- A blocker should include *what* is blocked and *what would unblock it* — not just "waiting on X"
- If there are no blockers, write "None" rather than omitting the section

## Optional: Alternate Formats

If the user wants a different format, offer these:
- **Slack one-liner**: `:white_check_mark: [yesterday] | :hammer_and_wrench: [today] | :warning: [blockers or none]`
- **Email**: Subject: "Standup [Date]" with the same three sections in prose
- **Async written standup**: More detail, fewer bullet points — useful for remote teams with no live meeting

## Tips

1. **Run it at the same time each morning** — consistency beats perfection.
2. **Add nuance after** — I'll generate the skeleton; you add the human context.
3. **Share the format** — Paste the output directly into Slack/email/your standup tool.
