"""
Pre-Generation Validator — Scans generated content for false negatives and rewrites directly.
"""
import logging
from services.llm import complete
from services.text_cleaner import detect_false_negatives

log = logging.getLogger("ai-engine.pre_generation_validator")

SYSTEM_PROMPT = """You are an expert editor specializing in eliminating AI writing tropes and rhetorical false negatives.

CRITICAL INSTRUCTION:
Eliminate all false negative contrasts (e.g., "It's not just X, it's Y", "This isn't about X, it's about Y", "Not only X, but also Y").
Rewrite every sentence into a direct, positive statement without losing any facts, meaning, or strategic depth.
Respond ONLY with the revised content — do not add any intro, outro, or commentary."""

USER_PROMPT_TEMPLATE = """Please rewrite the following content to eliminate all false negative patterns.

CONTENT TO REWRITE:
{content}

DETECTED PATTERNS TO ELIMINATE:
{patterns}

Return ONLY the corrected content."""


async def validate_and_fix(
    content: str,
    agent_name: str = "agent",
    max_attempts: int = 2,
) -> dict:
    """
    Scans content for false negatives and attempts to fix them via LLM rewrites.

    Returns:
        {
            "content": str,
            "false_negatives_found": int,
            "false_negatives_after": int,
            "fixed": bool,
            "tokens_used": int,
        }
    """
    if not content or not content.strip():
        return {
            "content": content,
            "false_negatives_found": 0,
            "false_negatives_after": 0,
            "fixed": True,
            "tokens_used": 0,
        }

    initial_findings = detect_false_negatives(content)
    initial_count = len(initial_findings)

    if initial_count == 0:
        return {
            "content": content,
            "false_negatives_found": 0,
            "false_negatives_after": 0,
            "fixed": True,
            "tokens_used": 0,
        }

    log.info(
        "Pre-Gen Validation triggered for %s | false_negs_found=%d",
        agent_name,
        initial_count,
    )

    current_content = content
    total_tokens = 0
    post_count = initial_count

    for attempt in range(1, max_attempts + 1):
        findings = detect_false_negatives(current_content)
        post_count = len(findings)
        if post_count == 0:
            break

        pattern_summary = "\n".join(
            f"- Match '{f['match']}' (pattern: {f['pattern']})"
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
            if revised_text and len(revised_text.strip()) > 50:
                current_content = revised_text.strip()
        except Exception as e:
            log.error("Pre-Gen validation LLM call failed for %s: %s", agent_name, e)
            break

    post_findings = detect_false_negatives(current_content)
    post_count = len(post_findings)

    return {
        "content": current_content,
        "false_negatives_found": initial_count,
        "false_negatives_after": post_count,
        "fixed": post_count == 0,
        "tokens_used": total_tokens,
    }
