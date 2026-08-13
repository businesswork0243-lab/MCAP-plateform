"""Agent 3 — Brand Optimizer: injects organizational identity into content."""
from services.llm import complete
import logging

log = logging.getLogger("ai-engine.brand_optimizer")

SYSTEM = """You are a brand strategist and editorial specialist.
Your task: align content with a specific brand's voice, tone, values, and guidelines.
Preserve all factual information and strategic meaning.
Only modify HOW things are expressed — never WHAT is said.
Never add unverified claims, statistics, or fabricated details."""

# ─── Prompt Template ──────────────────────────────────────────────────────────

USER_TEMPLATE = """Apply the following brand guidelines to this content.

CONTENT TO BRAND-ALIGN:
{content}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND IDENTITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Brand Name: {brand_name}
Mission: {mission}
Life Purpose: {life_purpose}

TONE PROFILE:
{tone_description}
  • Formality:      {formality}/10  ({formality_label})
  • Confidence:     {confidence}/10 ({confidence_label})
  • Technical Depth:{technical}/10  ({technical_label})
  • Enthusiasm:     {enthusiasm}/10
  • Empathy:        {empathy}/10

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND BELIEFS & CHARACTER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{beliefs_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VOCABULARY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Preferred Terms (use these): {preferred_terms}
Banned Phrases (NEVER use, replace with natural alternatives): {banned_phrases}

KEY MESSAGES (weave in naturally where relevant — don't force):
{key_messages}

COMPLIANCE NOTES:
{compliance_notes}

{document_context}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND ALIGNMENT RULES:
1. Replace ALL banned phrases with brand-appropriate alternatives
2. Use preferred terminology consistently
3. Adjust sentence structure to match formality/confidence levels
4. Reinforce key messages without sounding forced
5. Reflect brand beliefs — content should feel like it comes from a brand that
   stands for {stands_for_summary} and opposes {stands_against_summary}
6. Keep ALL facts, data, and statistics exactly as they are
7. Do NOT add any information not in the original

OUTPUT: Write only the brand-aligned content. No commentary, no labels.
"""


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _tone_label(value: float, low: str, mid: str, high: str) -> str:
    if value <= 3:   return low
    if value <= 6:   return mid
    return high


def _build_tone_description(tone: dict) -> str:
    """Build a human-readable tone description from settings."""
    formality   = tone.get("formality", 5)
    confidence  = tone.get("confidence", 5)
    technical   = tone.get("technical",  5)  # note: 'technical' not 'technicalDepth'
    humor       = tone.get("humor", 3)
    storytelling= tone.get("storytelling", 5)

    parts = []

    parts.append(_tone_label(
        formality,
        "Conversational and approachable",
        "Semi-formal, balanced",
        "Formal and professional",
    ))

    parts.append(_tone_label(
        confidence,
        "Measured, considerate, open",
        "Balanced confidence",
        "Authoritative, assertive, decisive",
    ))

    if technical >= 7:
        parts.append("Technically deep — assume expert audience")
    elif technical <= 3:
        parts.append("Accessible — minimal jargon, explain concepts")

    if humor >= 6:
        parts.append("Light humor and wit welcome")

    if storytelling >= 7:
        parts.append("Narrative and story-driven where possible")

    return "Tone: " + ". ".join(parts) + "."


def _build_beliefs_block(brand: dict) -> str:
    """Build the values/beliefs section of the prompt."""
    sections = []

    if likes := brand.get("likes"):
        sections.append(f"Brand LIKES & Champions:\n" +
                        "\n".join(f"  + {item}" for item in likes[:8]))

    if hates := brand.get("hates"):
        sections.append(f"Brand HATES (strong opposition — avoid these associations):\n" +
                        "\n".join(f"  ✗ {item}" for item in hates[:5]))

    if dislikes := brand.get("dislikes"):
        sections.append(f"Brand Dislikes (mild — avoid where possible):\n" +
                        "\n".join(f"  ~ {item}" for item in dislikes[:5]))

    if stands_for := brand.get("stands_for"):
        sections.append(f"Brand STANDS FOR:\n" +
                        "\n".join(f"  ✓ {item}" for item in stands_for[:6]))

    if stands_against := brand.get("stands_against"):
        sections.append(f"Brand STANDS AGAINST:\n" +
                        "\n".join(f"  ✗ {item}" for item in stands_against[:6]))

    if values := brand.get("core_values"):
        sections.append(f"Core Values:\n  {', '.join(values[:6])}")

    if motivations := brand.get("core_motivations"):
        sections.append(f"Core Motivations:\n  {', '.join(motivations[:5])}")

    return "\n\n".join(sections) if sections else "No specific beliefs defined."


def _summarize_list(items: list, limit: int = 3) -> str:
    if not items:
        return "not specified"
    return ", ".join(str(i) for i in items[:limit])


# ─── Agent Entry Point ────────────────────────────────────────────────────────

async def run(content: str, brand_profile: dict | None) -> dict:
    """Apply brand voice and guidelines to content."""

    # No brand profile — return as-is
    if not brand_profile:
        log.debug("No brand profile provided — skipping brand optimization")
        return {"content": content, "tokensUsed": 0, "agent": "brand_optimizer"}

    # ── Extract fields ────────────────────────────────────────────────────────
    tone_settings   = (
        brand_profile.get("tone_settings") or
        brand_profile.get("tone") or
        {}
    )

    preferred_terms  = brand_profile.get("preferred_terms")  or []
    banned_phrases   = brand_profile.get("banned_phrases")   or []
    key_messages     = brand_profile.get("key_messages")     or []
    compliance_notes = brand_profile.get("compliance_notes") or "None"

    # Extract document context (multiple possible keys)
    doc_context = (
        brand_profile.get("document_context")
        or brand_profile.get("doc_context")
        or ""
    )

    # ✅ FIX: Tone dimensions directly bhi check karo (flat DB columns)
    formality  = (tone_settings.get("formality")  or
                  brand_profile.get("tone_formality")  or 5)
    confidence = (tone_settings.get("confidence") or
                  brand_profile.get("tone_confidence") or 5)
    technical  = (tone_settings.get("technical")  or
                  brand_profile.get("tone_technical")  or 5)
    enthusiasm = (tone_settings.get("enthusiasm") or
                  brand_profile.get("tone_enthusiasm") or 5)
    empathy    = (tone_settings.get("empathy")    or
                  brand_profile.get("tone_empathy")    or 5)

    # Beliefs
    stands_for      = brand_profile.get("stands_for")      or []
    stands_against  = brand_profile.get("stands_against")  or []

    # ── Document Context Block (Priority 2 Fix) ───────────────────────
    doc_block = ""
    if doc_context and doc_context.strip():
        trimmed = doc_context[:6000]   # Increased from 3000 → 6000 chars

        doc_block = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND DOCUMENT GUIDELINES (UPLOADED DOCUMENTS):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{trimmed}

IMPORTANT: These are the actual brand documents uploaded by the user.
Prioritize tone, voice, messaging style, preferred language patterns,
and constraints mentioned in these documents over generic brand fields.
If the documents conflict with "preferred_terms" or "banned_phrases",
follow the uploaded documents.
"""

        log.info(
            "Brand document context LOADED | brand=%s | used_chars=%d | "
            "original_chars=%d | has_documents=True",
            brand_profile.get("name", "Unknown"),
            len(trimmed),
            len(doc_context),
        )
    else:
        log.warning(
            "No brand document context available for brand=%s | "
            "falling back to only structured brand fields",
            brand_profile.get("name", "Unknown"),
        )

    # ✅ FIX: compliance variable name typo fix
    compliance = compliance_notes

    user_prompt = USER_TEMPLATE.format(
        content=content,
        brand_name=brand_profile.get("name", "Unknown Brand"),
        mission=(
            brand_profile.get("mission_statement") or
            brand_profile.get("missionStatement") or
            brand_profile.get("mission") or
            "Not specified"
        ),
        life_purpose=brand_profile.get("life_purpose") or "Not specified",
        tone_description=_build_tone_description(tone_settings),
        formality=formality,
        formality_label=_tone_label(formality, "Casual", "Semi-formal", "Formal"),
        confidence=confidence,
        confidence_label=_tone_label(confidence, "Gentle", "Balanced", "Authoritative"),
        technical=technical,
        technical_label=_tone_label(technical, "Simple", "Moderate", "Deep"),
        enthusiasm=enthusiasm,
        empathy=empathy,
        beliefs_block=_build_beliefs_block(brand_profile),
        stands_for_summary=_summarize_list(stands_for),
        stands_against_summary=_summarize_list(stands_against),
        preferred_terms=(
            ", ".join(preferred_terms) if preferred_terms
            else "None specified"
        ),
        banned_phrases=(
            ", ".join(banned_phrases) if banned_phrases
            else "None specified"
        ),
        key_messages=(
            "\n".join(f"• {m}" for m in key_messages) if key_messages
            else "None specified"
        ),
        compliance_notes=compliance,
        document_context=doc_block,
    )

    # Estimate max tokens based on content length
    content_words = len(content.split())
    max_tok = min(int(content_words * 1.4) + 500, 4096)

    log.info(
        "Brand optimizer | brand=%s | content_words=%d | "
        "has_docs=%s | banned=%d",
        brand_profile.get("name", "?"),
        content_words,
        bool(doc_context),
        len(banned_phrases),
    )

    result, tokens = await complete(
        SYSTEM,
        user_prompt,
        temperature=0.5,
        max_tokens=max_tok,
    )

    return {
        "content":    result,
        "tokensUsed": tokens,
        "agent":      "brand_optimizer",
    }
