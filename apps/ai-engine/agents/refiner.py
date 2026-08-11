# apps/ai-engine/agents/refiner.py
"""Agent 6 — Content Refiner: applies user-requested improvements to existing content."""
import logging
from services.llm import complete

log = logging.getLogger("ai-engine.refiner")

SYSTEM = """You are an expert content editor and refinement specialist.

Your job: Take existing content and apply SPECIFIC user-requested improvements.

CORE PRINCIPLES:
1. Preserve the core message and factual accuracy
2. Apply ONLY the improvements user requests — don't over-edit
3. Maintain the original platform format (LinkedIn/Twitter/Blog etc)
4. Keep brand voice consistent
5. Never fabricate statistics, data, or claims
6. If user asks for "shorter" — cut fluff, keep substance
7. If user asks for "more detailed" — add depth using existing context, don't invent

FORBIDDEN:
- Adding fake statistics or data points
- Introducing false negatives ("not just X, it's Y")
- Corporate buzzwords (leverage, synergy, unlock the power, etc.)
- AI clichés (in today's fast-paced world, delve into, etc.)

OUTPUT: Write only the refined content. No commentary, no explanations, no labels."""


# ─── Quick Refinement Tags → Instructions Map ─────────────────────────────────

QUICK_TAG_INSTRUCTIONS = {
    "punchy": (
        "Make it more punchy: shorter sentences, stronger verbs, "
        "remove hedging words (maybe, perhaps, might). Cut filler."
    ),
    "add_stats": (
        "Add relevant data points, percentages, or numbers where they "
        "strengthen claims. Only use realistic figures — never fabricate specific numbers. "
        "Use ranges or qualitative descriptions if exact data unavailable."
    ),
    "sharper_hook": (
        "Rewrite the opening/hook to be more provocative and attention-grabbing. "
        "Start with a bold claim, surprising fact, or contrarian statement. "
        "First 1-2 sentences must make readers NEED to continue."
    ),
    "more_casual": (
        "Reduce formality. Use contractions (it's, we're, you'll). "
        "Add conversational phrases. Write like you're talking to a colleague."
    ),
    "shorter": (
        "Cut length by 30-40%. Remove redundant sentences, filler phrases, "
        "and repetitive points. Keep only the strongest arguments."
    ),
    "more_detailed": (
        "Add depth with specific examples, elaboration on key points, "
        "and more nuanced explanation. Expand where the content is thin."
    ),
    "add_cta": (
        "Add a clear, compelling call-to-action at the end. "
        "Make it specific and actionable — not generic."
    ),
    "storytelling": (
        "Restructure as a narrative: set scene, introduce tension, "
        "reveal insight, deliver payoff. Use story elements."
    ),
    "more_professional": (
        "Increase formality and authority. Use industry-appropriate terminology. "
        "Remove overly casual phrases. Sound like a subject matter expert."
    ),
    "more_inspiring": (
        "Add motivational, emotional resonance. Use aspirational language. "
        "Frame challenges as opportunities. End on a powerful note."
    ),
    "remove_jargon": (
        "Replace technical jargon with simple, clear language. "
        "Explain concepts in accessible terms. Assume smart but non-expert reader."
    ),
    "add_examples": (
        "Add 1-2 concrete examples or case studies to illustrate main points. "
        "Use realistic scenarios — don't invent specific companies or names."
    ),
}


# ─── Prompt Template ──────────────────────────────────────────────────────────

USER_TEMPLATE = """Refine the following content based on user's specific requests.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ORIGINAL CONTENT:
{original_content}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PLATFORM: {platform}
{brand_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USER'S REFINEMENT REQUEST:
{user_prompt}

{quick_improvements}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REFINEMENT RULES:
1. Apply the improvements user requested
2. Keep original structure intact (headings, paragraphs, format)
3. Preserve all factual content unless user requests changes
4. Maintain platform-specific formatting for {platform}
5. Do NOT add fabricated data or claims
6. Do NOT introduce AI clichés or false negatives

Output only the refined content:"""


async def run(
    original_content: str,
    user_prompt: str = "",
    quick_tags: list[str] | None = None,
    platform: str = "linkedin_post",
    brand_profile: dict | None = None,
    preserve_length: bool = False,
) -> dict:
    """
    Refine existing content based on user feedback.
    
    Args:
        original_content: The content to refine
        user_prompt: Free-form user instructions
        quick_tags: List of preset tag keys (e.g., ['punchy', 'add_stats'])
        platform: Target platform for format preservation
        brand_profile: Optional brand data for voice consistency
        preserve_length: If True, maintain similar length
    
    Returns:
        {"content": str, "tokensUsed": int, "agent": "refiner"}
    """
    # ── Input validation ──────────────────────────────────────────────────────
    if not original_content or not isinstance(original_content, str):
        log.error("Refiner received invalid content")
        return {
            "content": original_content or "",
            "tokensUsed": 0,
            "agent": "refiner",
            "error": "invalid_input",
        }
    
    if not user_prompt and not quick_tags:
        log.warning("No refinement instructions provided")
        return {
            "content": original_content,
            "tokensUsed": 0,
            "agent": "refiner",
            "error": "no_instructions",
        }
    
    # ── Build quick improvements block ────────────────────────────────────────
    quick_improvements = ""
    if quick_tags:
        valid_tags = [t for t in quick_tags if t in QUICK_TAG_INSTRUCTIONS]
        if valid_tags:
            lines = ["QUICK IMPROVEMENTS TO APPLY:"]
            for tag in valid_tags:
                lines.append(f"  • {QUICK_TAG_INSTRUCTIONS[tag]}")
            quick_improvements = "\n".join(lines)
    
    # ── Build brand context ───────────────────────────────────────────────────
    brand_context = ""
    if brand_profile and isinstance(brand_profile, dict):
        brand_parts = []
        if name := brand_profile.get("name"):
            brand_parts.append(f"Brand: {name}")
        if voice := brand_profile.get("voice"):
            brand_parts.append(f"Voice: {voice}")
        if banned := brand_profile.get("banned_phrases"):
            if isinstance(banned, list) and banned:
                brand_parts.append(f"NEVER use: {', '.join(banned[:10])}")
        if preferred := brand_profile.get("preferred_terms"):
            if isinstance(preferred, list) and preferred:
                brand_parts.append(f"PREFER: {', '.join(preferred[:10])}")
        
        if brand_parts:
            brand_context = "BRAND CONTEXT:\n" + "\n".join(f"  • {p}" for p in brand_parts)
    
    # ── Format user prompt ────────────────────────────────────────────────────
    formatted_prompt = user_prompt.strip() if user_prompt else "Apply the quick improvements above."
    
    # ── Build user template ───────────────────────────────────────────────────
    user_message = USER_TEMPLATE.format(
        original_content=original_content,
        platform=platform,
        brand_context=brand_context,
        user_prompt=formatted_prompt,
        quick_improvements=quick_improvements,
    )
    
    # ── Token budget ──────────────────────────────────────────────────────────
    content_words = len(original_content.split())
    if preserve_length:
        max_tok = min(int(content_words * 1.3) + 300, 5000)
    else:
        max_tok = min(int(content_words * 2) + 500, 6000)
    
    log.info(
        "Refiner start | platform=%s | words=%d | tags=%s | has_prompt=%s",
        platform, content_words, quick_tags or [], bool(user_prompt),
    )
    
    # ── Call LLM ──────────────────────────────────────────────────────────────
    try:
        refined_content, tokens = await complete(
            SYSTEM,
            user_message,
            temperature=0.7,
            max_tokens=max_tok,
        )
        
        if not refined_content or not isinstance(refined_content, str):
            log.error("Refiner returned empty content")
            return {
                "content": original_content,
                "tokensUsed": tokens,
                "agent": "refiner",
                "error": "empty_response",
            }
        
        log.info(
            "Refiner complete | tokens=%d | before=%d chars | after=%d chars",
            tokens, len(original_content), len(refined_content),
        )
        
        return {
            "content": refined_content.strip(),
            "tokensUsed": tokens,
            "agent": "refiner",
            "platform": platform,
            "improvements_applied": {
                "user_prompt": user_prompt,
                "quick_tags": quick_tags or [],
            },
        }
        
    except Exception as e:
        log.error("Refiner failed: %s", e)
        return {
            "content": original_content,
            "tokensUsed": 0,
            "agent": "refiner",
            "error": f"{type(e).__name__}: {str(e)[:200]}",
        }
