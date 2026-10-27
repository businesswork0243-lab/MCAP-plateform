"""Agent 2 — Platform Optimizer: writes the piece natively for each channel.

The first version of this agent was told to "transform" the article and was only
allowed to cut and reorder it. That produces excerpts: every short format came
out as the same four sentences from the article, differently trimmed. It now
works in three steps.

  1. `build_brief` reads the article once and extracts the thesis, the points
     worth making, the evidence, and the lines worth quoting. Every platform
     writes from this one brief, so the formats agree with each other without
     copying each other.
  2. `run` writes the piece for one channel from that brief, following the
     format's craft notes in `services.format_specs`.
  3. The result is checked against the format by code (length, characters,
     hashtags, copied sentences, placeholders). If it fails, one repair call
     fixes exactly what failed.

The no-new-facts rule is unchanged and stays the first thing the model reads.
"""
from __future__ import annotations

import json
import logging
import re

from services.llm import complete
from services import format_specs

log = logging.getLogger("ai-engine.platform_optimizer")

NL = chr(10)

SYSTEM = """You are a writer who has published on every channel you are asked to write for.
You write each piece as if it had been written for that channel from the start. You do not summarise an article and you do not paste excerpts from it.

THE ONE RULE THAT OVERRIDES THE REST: you may not add any fact, number, name, credential, anecdote or experience that is not in the source material. You may rephrase, reorder, cut, emphasise and put things in new words. Where the source is vague, stay vague. If a format asks for something the source does not contain (a testimonial, a statistic, a bio), leave it out or mark the slot, never invent it.

HOW YOU WRITE
- Start from the idea, not from the article's sentences. Say it in this format's own voice.
- Be specific. Every piece contains at least one concrete detail from the source (a mechanism, a number, a named case). A piece that is all claims and no detail is not finished.
- One thesis per piece. If the format is short, drop points; do not compress all of them into slogans.
- Vary sentence length. Do not build a piece from a run of very short lines, and do not end paragraphs on a line that only restates the one before it.
- Say what something is. Do not set up a contrast by first saying what it is not.
- Plain words. No filler openers such as "In today's world", and none of: leverage, unlock, transformative, seamless, robust, game-changer.
- Any MUST-PRESERVE item in the prompt survives into the piece.

OUTPUT: the finished piece only. No preamble, no labels such as "Here is", no commentary."""

BRIEF_SYSTEM = """You extract a writing brief from an article so that several different formats can be written from it without repeating each other.
Return ONLY valid JSON. Use only what the article says; add nothing."""

BRIEF_TEMPLATE = """ARTICLE:
{article}

Return JSON with exactly these keys:
{{
  "thesis": "the single claim of the piece, one sentence, in plain words",
  "reader": "who this is for and what they currently believe or do",
  "points": ["3 to 6 distinct supporting points, each one sentence, in the order of the argument"],
  "evidence": ["concrete details the article gives: mechanisms, numbers, named cases, examples. Empty list if none"],
  "quotable": ["2 to 4 short lines from the article worth quoting as written"],
  "cta": "what the article asks the reader to do, or empty string"
}}"""

USER_TEMPLATE = """Write a {platform_name} from the material below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WRITING BRIEF (the ideas to work from)
{brief}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FULL ARTICLE (source of truth for every fact; do not copy its sentences)
{canonical_draft}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT: {platform_name}   LENGTH: {length}
{voice_block}
HOW TO WRITE IT
{format_brief}

FORMAT RULES
{rules}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{extra_instructions}
Write the {platform_name} now:"""

REPAIR_TEMPLATE = """This {platform_name} was written, but it breaks the format. Fix ONLY the problems listed and keep everything else as it is.

PROBLEMS
{problems}

THE PIECE
{content}

Rules: do not add any new fact; keep the same ideas and voice; keep the format conventions ({rules}).
Return only the corrected piece."""


def _voice_block(voice_target: str) -> str:
    """The brand's measured rhythm, when there is one to give."""
    if not voice_target or not voice_target.strip():
        return ""
    return (
        NL + voice_target.strip() + NL
        + "Treat this as the rhythm to write toward, in your own sentences. If the brand writes "
        "in first person and the article contains first-person statements ('we', 'our'), a "
        "first-person line that restates one of them in new words suits the voice. Never add "
        "a first-person claim the article does not make." + NL
    )


# ─── Brief ────────────────────────────────────────────────────────────────────

def _parse_json(raw: str) -> dict | None:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(raw[start:end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def format_brief(brief: dict | None) -> str:
    """The brief as text for a prompt, or a note that there is none."""
    if not brief:
        return "(no separate brief; work from the article below)"

    def bullets(items) -> str:
        items = [str(i).strip() for i in (items or []) if str(i).strip()]
        return NL.join(f"  - {i}" for i in items) if items else "  (none)"

    return NL.join([
        f"Thesis: {brief.get('thesis', '')}",
        f"Reader: {brief.get('reader', '')}",
        "Points:" + NL + bullets(brief.get("points")),
        "Evidence:" + NL + bullets(brief.get("evidence")),
        "Lines worth quoting (use at most one, exactly as written):" + NL + bullets(brief.get("quotable")),
    ])


async def build_brief(canonical_draft: str) -> tuple[dict | None, int]:
    """One cheap call that every platform then shares. None on any failure.

    Failure is never fatal: each platform falls back to the article alone, which
    is how the agent worked before.
    """
    if not canonical_draft or len(canonical_draft.split()) < 60:
        return None, 0
    try:
        raw, tokens = await complete(
            BRIEF_SYSTEM,
            BRIEF_TEMPLATE.format(article=canonical_draft[:14000]),
            temperature=0.2,
            max_tokens=900,
        )
    except Exception as e:
        log.warning("Brief extraction failed (non-fatal): %s", e)
        return None, 0

    brief = _parse_json(raw)
    if not brief or not brief.get("thesis"):
        log.warning("Brief extraction returned unusable JSON (non-fatal)")
        return None, tokens
    return brief, tokens


# ─── Agent entry point ────────────────────────────────────────────────────────

async def run(
    canonical_draft: str,
    target_platform: str,
    audience_note:   str        = "",
    word_count:      int | None = None,
    seo_enabled:     bool       = False,
    seo_settings:    dict | None = None,
    cta:             str        = "",
    must_preserve:   str        = "",
    brief:           dict | None = None,
    voice_target:    str        = "",
) -> dict:
    """Write the canonical article's ideas as `target_platform` content."""
    spec = format_specs.get_spec(target_platform)

    extra_parts = []
    if must_preserve and must_preserve.strip():
        # Compression used to drop strategic framing the user had asked for,
        # because this agent never saw the request.
        extra_parts.append(
            "MUST-PRESERVE (from the original request; these survive the cut):"
            + NL + must_preserve.strip()
        )
    if audience_note:
        extra_parts.append(f"AUDIENCE NOTE:{NL}{audience_note}")
    if cta:
        extra_parts.append(f"CALL TO ACTION:{NL}{cta}")
    if word_count:
        extra_parts.append(f"TARGET LENGTH: about {word_count} words.")
    if seo_enabled and seo_settings:
        from services.prompt_compiler import _build_seo_block
        seo_text = _build_seo_block(seo_enabled, seo_settings)
        if seo_text:
            extra_parts.append(seo_text)
    extra_instructions = (NL + NL).join(extra_parts)

    user_prompt = USER_TEMPLATE.format(
        platform_name=spec.name,
        brief=format_brief(brief),
        canonical_draft=canonical_draft,
        length=spec.length_label,
        voice_block=_voice_block(voice_target),
        format_brief=spec.brief,
        rules=format_specs.describe_rules(spec),
        extra_instructions=(extra_instructions + NL) if extra_instructions else "",
    )

    content, tokens = await complete(
        SYSTEM,
        user_prompt,
        temperature=0.65,
        max_tokens=spec.max_tokens,
    )
    content = (content or "").strip()
    total_tokens = tokens

    # ── Check the result against the format, repair once ──────────────────────
    issues = format_specs.check(target_platform, content, source=canonical_draft)
    repaired = False
    # Two tries at most. A character limit is a fact, not a preference, and one
    # repair used to fix three over-long tweets and leave a fourth.
    for attempt in range(2):
        if not issues:
            break
        log.info("Platform %s needs repair (try %d): %s", target_platform, attempt + 1, "; ".join(issues))
        try:
            fixed, fix_tokens = await complete(
                SYSTEM,
                REPAIR_TEMPLATE.format(
                    platform_name=spec.name,
                    problems=NL.join(f"  - {i}" for i in issues),
                    content=content,
                    rules="; ".join(spec.rules),
                ),
                temperature=0.3,
                max_tokens=spec.max_tokens,
            )
            total_tokens += fix_tokens
            fixed = (fixed or "").strip()
            remaining = format_specs.check(target_platform, fixed, source=canonical_draft)
            # Keep the repair only if it actually helped.
            if fixed and format_specs.rank(target_platform, fixed, canonical_draft) < format_specs.rank(
                target_platform, content, canonical_draft
            ):
                content, issues, repaired = fixed, remaining, True
            else:
                break
        except Exception as e:
            log.warning("Platform repair failed for %s (non-fatal): %s", target_platform, e)
            break

    content = format_specs.enforce_hard_limits(target_platform, content)
    issues = format_specs.check(target_platform, content, source=canonical_draft)

    return {
        "content":    content,
        "tokensUsed": total_tokens,
        "agent":      "platform_optimizer",
        "platform":   target_platform,
        "formatIssues": issues,
        "repaired":   repaired,
    }
