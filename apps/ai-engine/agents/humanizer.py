# apps/ai-engine/agents/humanizer.py
"""
Humanizer v3.0 — Single-pass optimized
Before: 3 LLM calls = 60-120s
After:  1 LLM call  = 15-25s
"""

import uuid
import logging
from services.llm import complete
from services.text_cleaner import (
    clean_ai_patterns,
    detect_all_patterns,
    detect_false_negatives,
)

log = logging.getLogger("ai-engine.humanizer")

_rule_engine = None

def _get_rule_engine():
    global _rule_engine
    if _rule_engine is None:
        from agents.rule_engine.orchestrator import RuleEngineOrchestrator
        _rule_engine = RuleEngineOrchestrator()
        log.info("Rule Engine initialized")
    return _rule_engine


# ── System Prompt ─────────────────────────────────────────────────────────────

SYSTEM = """You are an expert editor. Transform AI-generated content into 
natural human prose in ONE pass. Do everything simultaneously:

TASK 1 — ELIMINATE FALSE NEGATIVES (CRITICAL):
Any "not X, it's Y" construction is FORBIDDEN. Convert to direct assertion.
  ❌ "It's not just crypto, it's trust"
  ✅ "It builds trust through cryptography"
  ❌ "Not only does it scale, but it secures"
  ✅ "It scales and secures simultaneously"

TASK 2 — REMOVE AI CLICHÉS:
- Opening clichés: "In today's world", "In an era of", "At its core"
- Transitions: "Furthermore", "Moreover", "In conclusion", "That being said"
- Buzzwords: "Game-changing", "Revolutionary", "Leverage", "Utilize", "Robust"
- AI tells: "Delve into", "Comprehensive overview", "Nuanced understanding"

TASK 3 — HUMANIZE VOICE:
- Vary sentence lengths (mix short 5-8 word and longer sentences)
- Use contractions naturally (it's, you'll, we're)
- Replace generic adjectives with specific concrete ones

ABSOLUTE RULES:
- Keep ALL facts, statistics, names, data exactly as they are
- Do NOT add invented anecdotes or statistics
- Do NOT reduce content length by more than 10%
- Preserve overall structure
- Output ONLY the humanized content. No commentary."""


INTENSITY_CONFIG = {
    "light": {
        "instruction": "Minimal changes — only remove obvious AI tells. Keep structure intact.",
        "temperature": 0.45,
    },
    "medium": {
        "instruction": "Balanced — natural flow, remove all AI phrases, vary sentence rhythm.",
        "temperature": 0.62,
    },
    "aggressive": {
        "instruction": "Maximum — rewrite substantially for authentic human voice. Fragment sentences occasionally.",
        "temperature": 0.70,
    },
}

BANNED_PHRASES = [
    # False negatives (CRITICAL)
    "It's not just", "This isn't just", "It's not merely",
    "Not only", "More than just", "Far from being",
    "Rather than being", "Less about", "It's not about",
    # Opening clichés
    "In today's", "In an era", "In the age of",
    "In the realm of", "It is important to note",
    "It's worth noting", "It goes without saying",
    "When it comes to", "At its core", "At the heart of",
    # Transitions
    "In conclusion", "To summarize", "Furthermore",
    "Moreover", "Additionally", "That being said", "With that in mind",
    # Buzzwords
    "Game-changing", "Groundbreaking", "Revolutionary",
    "Transformative", "Paradigm shift", "Leverage",
    "Utilize", "Empower", "Facilitate", "Robust",
    "Seamless", "Holistic", "Cutting-edge",
    "Delve into", "Deep dive", "Unpack",
]

TONALITY_RULES = {
    "angry":      "Sharp, direct phrasing with measured indignation.",
    "excited":    "Varied punctuation, short punchy sentences, genuine energy.",
    "confident":  "Declarative statements, minimal hedging, direct.",
    "curious":    "Ask questions, invite reader to think alongside you.",
    "empathetic": "Warmer language, acknowledge shared experiences.",
    "playful":    "Light wordplay, unexpected word choices.",
    "serious":    "Measured pacing, weighty words, no humor.",
}

LANGUAGE_RULES = {
    "Hindi":    "Humanize in Hindi with natural idioms.",
    "Hinglish": "Natural Hindi-English mix as Indian professionals speak.",
    "Spanish":  "Humanize in Spanish with natural phrasing.",
    "French":   "Humanize in French with natural phrasing.",
}


def _build_user_prompt(
    content:       str,
    intensity:     str,
    tonality:      dict | None,
    language:      str,
    brand_phrases: list | None,
    pre_issues:    dict,
) -> str:
    config = INTENSITY_CONFIG.get(intensity, INTENSITY_CONFIG["medium"])

    # Pre-scan warnings
    warnings = []
    if pre_issues.get("false_negative_count", 0) > 0:
        fns      = detect_false_negatives(content)
        examples = [f"'{f['match']}'" for f in fns[:3]]
        warnings.append(
            f"⚠️ {pre_issues['false_negative_count']} FALSE NEGATIVE(S): "
            f"{', '.join(examples)} — convert ALL to direct assertions"
        )
    if pre_issues.get("ai_openings", 0) > 0:
        warnings.append(f"⚠️ {pre_issues['ai_openings']} AI OPENING(S) — rewrite")
    if pre_issues.get("buzzwords", 0) > 0:
        warnings.append(f"⚠️ {pre_issues['buzzwords']} BUZZWORD(S) — replace")

    warning_block = (
        "\n".join(warnings)
        if warnings
        else "✅ No major issues — focus on voice naturalness"
    )

    # Banned phrases
    all_banned = list(BANNED_PHRASES)
    if brand_phrases:
        all_banned.extend([p for p in brand_phrases if p not in all_banned])
    banned_block = "\n".join(f"  • {p}" for p in all_banned[:30])

    # Tonality
    tonality_block = ""
    if tonality and isinstance(tonality, dict):
        active = [
            (k, v) for k, v in tonality.items()
            if isinstance(v, (int, float)) and v >= 5 and k in TONALITY_RULES
        ]
        active.sort(key=lambda x: x[1], reverse=True)
        if active[:3]:
            lines = [
                f"  • {t.upper()} ({v}/10): {TONALITY_RULES[t]}"
                for t, v in active[:3]
            ]
            tonality_block = "TONE TO REFLECT:\n" + "\n".join(lines) + "\n\n"

    lang_note = LANGUAGE_RULES.get(language, f"Language: {language}")

    return f"""INTENSITY: {intensity.upper()} — {config['instruction']}

{warning_block}

LANGUAGE: {lang_note}

{tonality_block}BANNED PHRASES (eliminate every instance):
{banned_block}

CONTENT TO HUMANIZE:
{content}

Apply all three tasks simultaneously in one pass. Output only the humanized content:"""


# ── Main Entry Point ──────────────────────────────────────────────────────────

async def run(
    content:       str,
    intensity:     str        = "medium",
    tonality:      dict | None = None,
    language:      str        = "English",
    brand_phrases: list | None = None,
    user_prompt:   str        = "",
    brand_data:    dict | None = None,
    extra_context: dict | None = None,
    request_id:    str | None  = None,
) -> dict:
    """
    Humanize content — optimized single-pass.
    Before: 3 LLM calls (60-120s)
    After:  1 LLM call  (15-25s)
    """
    import traceback as _tb

    # Validate input
    if not content or not isinstance(content, str):
        return {
            "content":    str(content) if content else "",
            "tokensUsed": 0,
            "agent":      "humanizer",
            "intensity":  intensity,
            "metadata":   {"error": "invalid_input"},
        }

    if intensity not in INTENSITY_CONFIG:
        intensity = "medium"

    config = INTENSITY_CONFIG[intensity]

    # Pre-scan (fast, no LLM)
    try:
        pre_issues = detect_all_patterns(content)
    except Exception:
        pre_issues = {
            "total_issues": 0, "false_negative_count": 0,
            "ai_openings": 0, "buzzwords": 0, "transitions": 0,
        }

    content_words = len(content.split())
    max_tok       = min(int(content_words * 1.4) + 500, 6000)

    log.info(
        "Humanizer start | intensity=%s | words=%d | lang=%s | issues=%d",
        intensity, content_words, language, pre_issues.get("total_issues", 0),
    )

    # ── Single LLM Call ───────────────────────────────────────────────────────
    try:
        prompt_text = _build_user_prompt(
            content=content,
            intensity=intensity,
            tonality=tonality or (brand_data or {}).get("tone_settings"),
            language=language,
            brand_phrases=brand_phrases or (brand_data or {}).get("banned_phrases", []),
            pre_issues=pre_issues,
        )

        humanized, tokens = await complete(
            SYSTEM,
            prompt_text,
            temperature=config["temperature"],
            max_tokens=max_tok,
        )

    except Exception as e:
        log.error("Humanizer LLM failed: %s\n%s", e, _tb.format_exc())
        return {
            "content":    content,
            "tokensUsed": 0,
            "agent":      "humanizer",
            "intensity":  intensity,
            "metadata":   {"error": f"llm_failed: {str(e)[:200]}"},
        }

    if not humanized or not isinstance(humanized, str):
        return {
            "content":    content,
            "tokensUsed": 0,
            "agent":      "humanizer",
            "intensity":  intensity,
            "metadata":   {"error": "empty_llm_response"},
        }

    total_tokens = tokens

    # ── Deterministic Cleanup (no LLM, fast) ─────────────────────────────────
    try:
        cleanup_result = clean_ai_patterns(humanized, intensity=intensity)
        humanized      = cleanup_result.get("content", humanized)
    except Exception as e:
        log.warning("Cleanup failed (non-fatal): %s", e)

    # ── Rule Engine ───────────────────────────────────────────────────────────
    rule_engine_meta: dict = {"enabled": False}
    skip_rule_engine = bool((extra_context or {}).get("skip_rule_engine", False))

    if not skip_rule_engine:
        try:
            req_id = request_id or str(uuid.uuid4())
            engine = _get_rule_engine()

            re_result = await engine.process(
                content=humanized,
                user_prompt=user_prompt or content[:200],
                brand_data=brand_data or {},
                extra_context=extra_context,
                request_id=req_id,
            )

            if re_result and re_result.final_content:
                humanized = re_result.final_content
                static_val = re_result.static_validation
                rule_engine_meta = {
                    "enabled":     True,
                    "final_score": re_result.final_score,
                    "passed":      static_val.passed if static_val else False,
                    "iterations":  re_result.total_iterations,
                    "false_negatives_eliminated": re_result.false_negatives_eliminated,
                }
                log.info(
                    "Rule Engine done | score=%.1f%% | iterations=%d",
                    re_result.final_score, re_result.total_iterations,
                )
        except Exception as e:
            log.error("Rule Engine failed (non-fatal): %s", e)
            rule_engine_meta = {
                "enabled": True,
                "error":   f"{type(e).__name__}: {str(e)[:200]}",
            }
    else:
        log.info("Rule Engine skipped")
        rule_engine_meta = {"enabled": False, "reason": "skipped"}

    # Final metrics
    try:
        final_issues  = detect_all_patterns(humanized)
        pre_total     = pre_issues.get("total_issues", 0)
        post_total    = final_issues.get("total_issues", 0)
        reduction     = round(
            ((pre_total - post_total) / pre_total * 100)
            if pre_total > 0 else 100.0, 1
        )
    except Exception:
        final_issues = {"total_issues": 0}
        reduction    = 0

    log.info(
        "Humanizer done | tokens=%d | reduction=%.1f%%",
        total_tokens, reduction,
    )

    return {
        "content":    humanized,
        "tokensUsed": total_tokens,
        "agent":      "humanizer",
        "intensity":  intensity,
        "metadata": {
            "pre_issues":        pre_issues.get("total_issues", 0),
            "post_issues":       final_issues.get("total_issues", 0),
            "reduction_percent": reduction,
            "rule_engine":       rule_engine_meta,
        },
    }