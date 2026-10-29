"""Agent 3 — Brand Optimizer: injects organizational identity into content."""
from services.llm import complete
import logging
import os
import re

log = logging.getLogger("ai-engine.brand_optimizer")

# 6,000 characters showed this stage the first sixth of a 15-page brand report.
DOC_CHARS = int(os.getenv("BRAND_DOC_CHARS_BRAND", "12000"))

SYSTEM = """You are a brand editor. You adjust how a piece sounds so that it is recognisably this brand, and you leave what it says and how it is laid out alone.

The TONE PROFILE and the VOCABULARY RULES in the request are binding. Read the piece sentence by sentence against them. A sentence whose register conflicts with the profile (too formal for a casual brand, too flat for an energetic one, jargon for a plain-spoken one) is rewritten in the brand's register: change the words, the rhythm and the way it addresses the reader, not what it claims. A sentence that already fits stays exactly as written. If most of the piece conflicts with the profile, most of it will change; if none does, return it unchanged. Do not return a piece that conflicts with the tone profile on the grounds that it is acceptable.

Two limits. Add nothing: no new claim, figure, name, credential or example, and no change to what a sentence says. And do not rewrite for the sake of it: a sentence that fits the brand is left alone, because rewriting everything flattens the piece and strips out what makes the format work.

The output must keep the same format as the input: headings, line breaks, bullet lists, hashtag blocks, tweet separators (---), numbering, SUBJECT lines, stage directions in [brackets], and bracketed placeholders all stay. Length stays within about 10% of the input."""

# ─── Prompt Template ──────────────────────────────────────────────────────────

USER_TEMPLATE = """Apply the following brand guidelines to this content.

CONTENT TO BRAND-ALIGN:
{content}

{format_block}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND IDENTITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Brand Name: {brand_name}
Mission: {mission}
Vision: {vision}
Life Purpose: {life_purpose}
Positioning: {positioning}
Description: {description}

VALUE PROPOSITIONS (frame the content consistently with these — never add
them as new claims the original does not make):
{value_propositions}

TONE PROFILE:
{tone_description}
  • Formality:      {formality}/10  ({formality_label})
  • Confidence:     {confidence}/10 ({confidence_label})
  • Technical Depth:{technical}/10  ({technical_label})
  • Enthusiasm:     {enthusiasm}/10
  • Empathy:        {empathy}/10
  • Humor:          {humor}/10
  • Storytelling:   {storytelling}/10

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND BELIEFS & CHARACTER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{beliefs_block}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VOCABULARY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Preferred Terms (use these): {preferred_terms}
Industry Vocabulary (use where it fits): {industry_vocabulary}
Banned Phrases (NEVER use, replace with natural alternatives): {banned_phrases}

KEY MESSAGES (weave in naturally where relevant — don't force):
{key_messages}

COMPLIANCE NOTES:
{compliance_notes}

{document_context}
{example_block}
{voice_block}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRAND ALIGNMENT RULES:
1. Replace every banned phrase with plain wording that fits the sentence
2. Use preferred terms where they fit naturally; never force one in
3. Match the tone profile in sentence structure and word choice: contractions, direct address of the reader and plain words for a casual profile; full forms and precise terms for a formal one; a concrete moment instead of an abstract claim for a storytelling one
4. Move sentence length and paragraph size toward the brand's measured rhythm when one is given above
5. Weave in a key message only where the content already makes that point; never add a point
6. The content should feel written by a brand that stands for {stands_for_summary} and opposes {stands_against_summary}, in word choice and emphasis only
7. Keep every fact, figure and name exactly as written
8. Do not add a sign-off, brand name, slogan or CTA that the content does not already have
9. Keep the format exactly as described in the instructions you were given

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


# ─── Tone enforcement ─────────────────────────────────────────────────────────

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
_HASHTAG = re.compile(r"(?<![\w&])#[A-Za-z]\w*")


def _safe_rewrite(original: str, rewritten: str, banned: list[str]) -> bool:
    """A retry is kept only if it changed how the piece sounds and nothing it says."""
    if not rewritten or not rewritten.strip():
        return False
    if {n.rstrip(",") for n in _NUMBER.findall(original)} - {n.rstrip(",") for n in _NUMBER.findall(rewritten)}:
        return False                                   # a figure was dropped or altered
    if len(_HASHTAG.findall(original)) != len(_HASHTAG.findall(rewritten)):
        return False                                   # the format furniture changed
    ratio = len(rewritten.split()) / max(len(original.split()), 1)
    if not 0.85 <= ratio <= 1.15:
        return False
    low = rewritten.lower()
    return not any(b.lower() in low for b in banned if b)


# The main prompt tells the model to leave a sentence alone when it fits, and a
# model that has just read that returns a formal draft unchanged even when the
# brand is casual. The retry is for a piece already measured as out of register,
# so it asks for the change and says how much.
RETRY_SYSTEM = """You are a copy editor. The piece you are given reads too formal and too distant for the brand's voice, and has been measured as such. Rewrite it so it sounds the way the brand speaks, as the findings in the request describe.

Change the register of at least a third of the sentences: shorter, plainer words; contractions; speaking to the reader as "you" where it fits. Do this by rewording, never by adding or removing facts.

Hard limits: keep every fact, figure, name, date and hashtag exactly; keep the order of the argument; keep the length within 10%. Add no claim, story or experience. Output only the rewritten piece."""


async def _enforce_tone(
    original: str, result: str, tone: dict, banned: list[str], user_prompt: str, max_tok: int,
) -> tuple[str, int, list[str]]:
    from services.brand_tone import gaps, contract, expand

    found = gaps(result, tone)
    if not found:
        return result, 0, []

    # Contractions are mechanical and touch no fact, so code applies them.
    codes = {code for code, _ in found}
    if "contractions" in codes:
        result = contract(result)
    elif "expand" in codes:
        result = expand(result)
    found = gaps(result, tone)
    if not found:
        return result, 0, []

    # What is left needs judgement (speaking to the reader): one targeted retry.
    nl = chr(10)
    rule = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    retry_prompt = (
        user_prompt + nl + nl + rule + nl
        + "YOUR PREVIOUS ATTEMPT DID NOT MEET THE TONE PROFILE" + nl + rule + nl
        + nl.join(f"- {msg}" for _, msg in found) + nl
        + "Rewrite the version below to fix this. Change how it sounds, not what it says: keep every fact, "
        "figure, name, hashtag and the length within 10%." + nl + nl
        + "VERSION TO REWRITE:" + nl + result
    )
    try:
        retried, tokens = await complete(RETRY_SYSTEM, retry_prompt, temperature=0.6, max_tokens=max_tok)
    except Exception as e:  # pragma: no cover - the retry must never lose the first result
        log.warning("Brand optimizer tone retry failed (non-fatal): %s", e)
        return result, 0, [msg for _, msg in found]
    retried_gaps = gaps(retried, tone)
    if _safe_rewrite(original, retried, banned) and len(retried_gaps) < len(found):
        return retried, tokens, [msg for _, msg in retried_gaps]
    return result, tokens, [msg for _, msg in found]


# ─── Agent Entry Point ────────────────────────────────────────────────────────

async def run(content: str, brand_profile: dict | None, platform: str | None = None) -> dict:
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
        trimmed = doc_context[:DOC_CHARS]

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

    # Past brand content shows the voice; its facts belong to other posts.
    examples = [
        str(e.get("content") or e.get("text") or e) if isinstance(e, dict) else str(e)
        for e in (brand_profile.get("example_content") or [])
    ]
    examples = [e.strip() for e in examples if e and e.strip()]
    example_block = ""
    if examples:
        example_block = (
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            "EXAMPLE BRAND CONTENT (voice reference only — match how it sounds,\n"
            "never copy its sentences or carry over its facts):\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            + "\n\n---\n\n".join(examples[:3])[:3000]
        )

    # The writer is given the brand's measured rhythm, but the platform pass
    # that follows compresses the draft and the rhythm is lost with it. This
    # is the stage that restores brand voice, so it gets the target too.
    voice_block = ""
    try:
        from services.voice import measure, describe
        from services.verified_facts import source_document
        described = describe(measure(source_document(brand_profile)), tone_settings)
        if described:
            voice_block = (
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" + chr(10)
                + described + chr(10) + chr(10)
                + "Move the content toward this rhythm without adding facts or "
                "changing its length much. It is a centre of gravity, not a rule "
                "for every line." + chr(10)
                + "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            )
    except Exception as e:  # pragma: no cover - measurement must never block
        log.warning("Voice measurement unavailable (non-fatal): %s", e)

    format_block = ""
    if platform:
        from services import format_specs
        spec = format_specs.get_spec(platform)
        format_block = (
            f"FORMAT: this is a {spec.name} ({spec.length_label}). Rules it must keep:\n"
            + format_specs.describe_rules(spec)
            + "\n\n"
        )

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
        vision=brand_profile.get("vision") or "Not specified",
        positioning=brand_profile.get("positioning") or "Not specified",
        description=brand_profile.get("description") or "Not specified",
        value_propositions=(
            "\n".join(f"• {v}" for v in brand_profile.get("value_propositions") or [])
            or "None specified"
        ),
        industry_vocabulary=(
            ", ".join(brand_profile.get("industry_vocabulary") or [])
            or "None specified"
        ),
        example_block=example_block,
        voice_block=voice_block,
        format_block=format_block,
        tone_description=_build_tone_description(tone_settings),
        formality=formality,
        formality_label=_tone_label(formality, "Casual", "Semi-formal", "Formal"),
        confidence=confidence,
        confidence_label=_tone_label(confidence, "Gentle", "Balanced", "Authoritative"),
        technical=technical,
        technical_label=_tone_label(technical, "Simple", "Moderate", "Deep"),
        enthusiasm=enthusiasm,
        empathy=empathy,
        humor=tone_settings.get("humor", brand_profile.get("tone_humor", 3)),
        storytelling=tone_settings.get("storytelling", brand_profile.get("tone_storytelling", 5)),
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

    # The model is told to leave passages alone and, given a formal draft and a
    # casual brand, mostly did: the same draft came back unchanged under casual,
    # formal and extreme-casual settings alike. Register has countable signs, so
    # they are counted, and a text that contradicts the sliders gets one targeted
    # retry that names the gap.
    result, retry_tokens, tone_gaps = await _enforce_tone(
        content, result, tone_settings, banned_phrases, user_prompt, max_tok,
    )
    tokens += retry_tokens

    return {
        "content":    result,
        "tokensUsed": tokens,
        "agent":      "brand_optimizer",
        "toneGaps":   tone_gaps,
    }
