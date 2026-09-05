---
name: polish-pass
description: Run a final review of accessibility, AI-template tropes, hierarchy/rhythm, and interaction states, then fix what's found. Use only when the user explicitly asks to polish the build, run final checks, or make it ready to ship.
---

# Polish Pass

An optional umbrella review for an interactive/visual build. A polished and an unpolished
build are the same idea at different levels of care — the gap is what people actually notice. Don't
run this on work that's still mid-structure (broken layout, missing sections, content the user is
still iterating on) — say so and ask whether to polish now or after the structure settles.

## Dispatch four checks

When the `agent` tool is available and the build is large enough to justify delegation, launch the
four checks in parallel. Each briefing must be self-contained: pass the file path and tell the agent
to read it before checking. Ask for concrete findings with severity and evidence, not speculative
low-confidence lists.

1. `read_skill accessibility-pass` and audit contrast, semantic HTML, keyboard/focus, and
   motion/forms.
2. `read_skill ai-slop-check` and scan for gradients, emoji, trope cards, weak illustration,
   overused fonts, the cream/serif/terracotta house style.
3. `read_skill hierarchy-rhythm-review` and check size/color/weight/position/density hierarchy plus
   spacing/type-scale rhythm.
4. `read_skill interaction-states-pass` and inventory every interactive element for
   hover/active/disabled/focus/loading plus transitions and action feedback.

If `agent` is unavailable or the build is small, run the checks yourself. Delegation is an
optimization, not part of the quality bar.

## Aggregate and fix

Merge the four reports, de-duplicating overlaps (a removed focus ring shows up in both accessibility
and interaction-states — one entry). Group into:

1. **Blockers** — accessibility failures (contrast under WCAG, no keyboard support, missing focus
   rings, missing labels). Fix all of them.
2. **Quality issues** — AI-slop tropes, broken hierarchy, missing interaction states. Fix all of
   them.
3. **Polish recommendations** — subtler calls (a color-tone nudge, tightening the spacing scale).
   Apply when in scope, flag when it's a bigger change than asked for.

Fix directly. For a finding that's a false positive or genuinely out of scope (a third-party embed
you can't touch), note it and move on rather than arguing with it.

## Re-check and hand off

After fixing, glance at the high-risk spots: did a contrast fix wash out the brand color, does a new
focus ring overlap neighboring content, does the CTA actually feel primary now? Fix anything off.

End with one short summary: ready to ship / ready once the user reviews flagged calls / needs more
iteration before polish is worth doing — plus blockers fixed, polish applied, and open decisions. No
recap of what the user just watched you do.
