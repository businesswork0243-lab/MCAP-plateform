"""
Pre-Generation Validator — Scans generated content for false negatives
and rewrites them directly via LLM.
"""
import logging
from services.llm import complete
from services.text_cleaner import detect_false_negatives

log = logging.getLogger("ai-engine.pre_generation_validator")

SYSTEM_PROMPT = """You are an expert editor specializing in eliminating AI writing tropes and rhetorical false negatives.

CRITICAL INSTRUCTION:
Eliminate all false negative contrasts such as:
  - "It's not just X, it's Y"
  - "This isn't about X, it's about Y"
  - "Not only X, but also Y"
  - "More than just X"
  - "Far from being X"
  - "Rather than being X"

Rewrite every such sentence into a direct, positive statement.
Do NOT lose any facts, meaning, or strategic depth.
Do NOT add new information.
Do NOT reduce content length by more than 10%.
Respond ONLY with the revised content — no intro, outro, or commentary."""

USER_PROMPT_TEMPLATE = """Please rewrite the following content to eliminate all false negative patterns.

CONTENT TO REWRITE:
{content}

DETECTED PATTERNS TO ELIMINATE:
{patterns}

RULES:
- Convert every false negative to a direct positive assertion
- Keep all facts, data, and structure intact
- Do not add invented information
- Return ONLY the corrected content — no commentary"""


async def validate_and_fix(
    content:      str,
    agent_name:   str = "agent",
    max_attempts: int = 2,
) -> dict:
    """
    Scans content for false negatives and fixes them via LLM.

    Returns:
        {
            "content":                str,
            "false_negatives_found":  int,
            "false_negatives_after":  int,
            "fixed":                  bool,
            "tokens_used":            int,
        }
    """
    # ── Empty content guard ───────────────────────────────────────────────────
    if not content or not content.strip():
        return {
            "content":               content,
            "false_negatives_found": 0,
            "false_negatives_after": 0,
            "fixed":                 True,
            "tokens_used":           0,
        }

    # ── Initial scan ──────────────────────────────────────────────────────────
    initial_findings = detect_false_negatives(content)
    initial_count    = len(initial_findings)

    # No issues found — return as-is
    if initial_count == 0:
        return {
            "content":               content,
            "false_negatives_found": 0,
            "false_negatives_after": 0,
            "fixed":                 True,
            "tokens_used":           0,
        }

    log.info(
        "Pre-Gen Validation triggered | agent=%s | false_negs_found=%d",
        agent_name,
        initial_count,
    )

    current_content = content
    total_tokens    = 0
    original_length = len(content)

    for attempt in range(1, max_attempts + 1):
        findings  = detect_false_negatives(current_content)
        remaining = len(findings)

        # Already clean — stop early
        if remaining == 0:
            log.info(
                "Pre-Gen clean after attempt %d | agent=%s",
                attempt - 1, agent_name,
            )
            break

        log.info(
            "Pre-Gen attempt %d/%d | agent=%s | remaining=%d",
            attempt, max_attempts, agent_name, remaining,
        )

        pattern_summary = "\n".join(
            f"- Match: '{f['match']}' (pattern: {f['pattern']})"
            for f in findings
        )

        user_msg = USER_PROMPT_TEMPLATE.format(
            content=current_content,
            patterns=pattern_summary,
        )

        try:
            revised_text, tokens = await complete(
                system=SYSTEM_PROMPT,
                user=user_msg,
                temperature=0.3,
            )
            total_tokens += tokens

            revised_stripped = revised_text.strip() if revised_text else ""
            revised_length   = len(revised_stripped)

            # ✅ FIX: Strict content validation
            # Old check: len > 50 (too weak — garbage response possible)
            # New check: length must be within 50%-200% of original
            min_acceptable = int(original_length * 0.5)
            max_acceptable = int(original_length * 2.0)

            if not revised_stripped:
                log.warning(
                    "Pre-Gen attempt %d: empty response — keeping current",
                    attempt,
                )
                continue

            if revised_length < min_acceptable:
                log.warning(
                    "Pre-Gen attempt %d: response too short "
                    "(original=%d, response=%d, min=%d) — keeping current",
                    attempt, original_length, revised_length, min_acceptable,
                )
                continue

            if revised_length > max_acceptable:
                log.warning(
                    "Pre-Gen attempt %d: response too long "
                    "(original=%d, response=%d, max=%d) — keeping current",
                    attempt, original_length, revised_length, max_acceptable,
                )
                continue

            # ✅ Verify it actually improved (fewer false negatives)
            revised_findings = detect_false_negatives(revised_stripped)
            if len(revised_findings) >= remaining:
                log.warning(
                    "Pre-Gen attempt %d: no improvement "
                    "(before=%d, after=%d) — keeping current",
                    attempt, remaining, len(revised_findings),
                )
                continue

            # ✅ Accept the revision
            log.info(
                "Pre-Gen attempt %d accepted | false_negs: %d → %d | "
                "length: %d → %d",
                attempt, remaining, len(revised_findings),
                original_length, revised_length,
            )
            current_content = revised_stripped

        except Exception as e:
            log.error(
                "Pre-Gen LLM call failed | agent=%s | attempt=%d | error=%s",
                agent_name, attempt, e,
            )
            break

    # ── Final scan ────────────────────────────────────────────────────────────
    post_findings = detect_false_negatives(current_content)
    post_count    = len(post_findings)
    fixed         = post_count == 0

    log.info(
        "Pre-Gen complete | agent=%s | found=%d | after=%d | fixed=%s | tokens=%d",
        agent_name, initial_count, post_count, fixed, total_tokens,
    )

    return {
        "content":               current_content,
        "false_negatives_found": initial_count,
        "false_negatives_after": post_count,
        "fixed":                 fixed,
        "tokens_used":           total_tokens,
    }