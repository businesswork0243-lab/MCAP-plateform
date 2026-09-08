"""Agent 5 — Editorial QA: validates quality, brand adherence, and content standards.

Scoring weights per spec:
  Brand adherence:       20%
  Readability:           15%
  Platform optimization: 15%
  Structure:             10%
  Humanization:          10%
  Consistency:           10%
  Clarity:               10%
  Engagement potential:   5%
  CTA alignment:          5%
"""
import json
import re
import logging
from collections import Counter
from services.llm import complete

log = logging.getLogger("ai-engine.qa")

SYSTEM = """You are a senior editorial QA specialist. Analyze content and return a STRICTLY VALID JSON assessment.
Be precise, objective, and consistent. Flag concrete, fixable issues only.
Do not invent flags. RESPOND WITH JSON ONLY — no other text before or after."""

# ─── Prompt Template ──────────────────────────────────────────────────────────

USER_TEMPLATE = """Perform a comprehensive editorial QA review of this content.

CONTENT:
{content}

CONTEXT:
- Brand: {brand_name}
- Brand Banned Phrases: {banned_phrases}
- Key Messages to Check: {key_messages}
- Compliance Notes: {compliance_notes}
{seo_block}

{grounding_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCORING DIMENSIONS (rate 0-100 each):

1. readabilityScore    — sentence variety, flow, paragraph structure, accessibility
2. brandScore         — brand voice, terminology, banned phrase compliance
3. structureScore     — logical flow, argument coherence, section completeness
4. platformScore      — appropriate length, formatting, audience fit
5. humanizationScore  — naturalness, absence of AI clichés, authentic voice
6. consistencyScore   — consistent tone, tense, perspective, terminology
7. clarityScore       — precise language, no vague filler, unambiguous claims
8. engagementScore    — hook quality, reader retention, compelling narrative
9. ctaScore           — CTA relevance and placement (score 50 if no CTA present)
10. groundingScore    — factual grounding. Every first-person claim about the
                        author (experience duration, role, employer, team,
                        clients, incidents, named frameworks, metrics, project
                        architecture) MUST be supported by the VERIFIED PROFILE
                        FACTS above. Score 0-30 if the content invents any of
                        them, 31-69 if claims are exaggerated or go beyond what
                        the profile supports, 70-100 if every claim traces back
                        to the profile. With no profile supplied, score on
                        whether the content avoids first-person claims entirely.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLAGS (only concrete, fixable issues):
- banned phrases still present
- significant word repeated 5+ times unnecessarily
- sentences exceeding 35 words (count them)
- unsupported vague claims ("everyone knows", "studies show" without citation)
- structural gaps
- formatting issues
- fabricated_experience: a first-person claim absent from the verified profile
  (quote the exact sentence)
- fabricated_metric: a number, benchmark or scale figure with no source
- fabricated_affiliation: a company, team, client or role not in the profile

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPOND WITH ONLY THIS JSON (no other text):
{{
  "readabilityScore":  <0-100>,
  "brandScore":        <0-100>,
  "structureScore":    <0-100>,
  "platformScore":     <0-100>,
  "humanizationScore": <0-100>,
  "consistencyScore":  <0-100>,
  "clarityScore":      <0-100>,
  "engagementScore":   <0-100>,
  "ctaScore":          <0-100>,
  "groundingScore":    <0-100>,
  "flags":             ["specific issue 1", "specific issue 2"],
  "suggestions":       ["actionable suggestion 1", "suggestion 2"],
  "summary":           "One sentence overall assessment"
}}"""

# ─── Scoring Config ───────────────────────────────────────────────────────────

SCORE_WEIGHTS = {
    "groundingScore":    0.20,
    "brandScore":        0.15,
    "readabilityScore":  0.12,
    "platformScore":     0.12,
    "structureScore":    0.08,
    "humanizationScore": 0.08,
    "consistencyScore":  0.08,
    "clarityScore":      0.08,
    "engagementScore":   0.05,
    "ctaScore":          0.04,
}

PASS_THRESHOLD     = 70   # Overall score
CRITICAL_MIN_SCORE = 50   # Any dimension below this = flag

# Invented experience published under a real person's name is the one defect
# that must never ship, so grounding gets a hard gate of its own rather than
# being averaged away by strong writing scores.
GROUNDING_MIN_SCORE = 70

# Flags that are "warnings" (don't fail the piece)
WARNING_FLAG_PATTERNS = [
    "overused_word",
    "sentence_length",
]

# Flags that are "critical" (can fail the piece)
CRITICAL_FLAG_PATTERNS = [
    "banned_phrase",
    "content_too_short",
    "structural_gap",
    "fabricated_experience",
    "fabricated_metric",
    "fabricated_affiliation",
    "fabricated",
]

# ─── Scoring ──────────────────────────────────────────────────────────────────

def _compute_weighted_score(scores: dict) -> int:
    total = sum(
        scores.get(key, 70) * weight
        for key, weight in SCORE_WEIGHTS.items()
    )
    return round(total)


def _count_critical_flags(flags: list[str]) -> int:
    """Count only critical flags (not warnings)."""
    count = 0
    for flag in flags:
        if any(pattern in flag.lower() for pattern in CRITICAL_FLAG_PATTERNS):
            count += 1
    return count


def _determine_pass(overall: int, scores: dict, flags: list[str]) -> bool:
    """
    Pass if:
    - Overall >= 70
    - No critical flags (banned phrases, structural gaps, etc.)
    - No dimension critically low (< 50)
    Warnings (overused words, long sentences) do NOT fail the piece.
    """
    if overall < PASS_THRESHOLD:
        return False

    # Grounding gate — strong writing must not carry invented experience
    # through. This is checked before the generic dimension floor because a
    # grounding score of 60 is a hard fail, not a warning.
    if scores.get("groundingScore", 70) < GROUNDING_MIN_SCORE:
        return False

    # Critical flags
    if _count_critical_flags(flags) > 0:
        return False

    # Any dimension critically low
    for key in SCORE_WEIGHTS:
        if scores.get(key, 70) < CRITICAL_MIN_SCORE:
            return False

    return True


# ─── Local Analysis (deterministic, no LLM) ──────────────────────────────────

def _local_analysis(
    content:        str,
    banned_phrases: list[str],
    seo_keyword:    str | None = None,
) -> list[str]:
    """Fast deterministic checks — no LLM needed."""
    flags = []
    words = content.lower().split()

    # 1. Banned phrase check
    content_lower = content.lower()
    for phrase in banned_phrases:
        if phrase.lower() in content_lower:
            flags.append(f'banned_phrase: "{phrase}"')

    # 2. Overused significant words
    significant = [
        w.strip(".,!?;:\"'()[]")
        for w in words
        if len(w) > 5 and w.isalpha()
    ]
    word_counts = Counter(significant)
    for word, count in word_counts.most_common(10):
        if count >= 5:
            # Skip if it's the topic keyword
            flags.append(f'overused_word: "{word}" ({count}×)')

    # 3. Very long sentences
    sentences = re.split(r'[.!?]+', content)
    long_sents = [s for s in sentences if len(s.split()) > 35]
    if len(long_sents) >= 2:
        flags.append(f"long_sentences: {len(long_sents)} sentences exceed 35 words")

    # 4. Too short
    word_count = len(words)
    if word_count < 50:
        flags.append(f"content_too_short: only {word_count} words")

    # 5. SEO check
    if seo_keyword and seo_keyword.lower() not in content_lower:
        flags.append(f'seo_keyword_missing: "{seo_keyword}" not found in content')

    # 6. Common vague claims
    vague_patterns = [
        r'\bstudies show\b',
        r'\beveryone knows\b',
        r'\bit is known\b',
        r'\bresearch suggests\b(?! that)',  # allow "research suggests that X" with specific claim
    ]
    for pattern in vague_patterns:
        if re.search(pattern, content_lower):
            # ✅ FIX: Extract pattern text outside f-string
            clean_pattern = pattern.replace(r'\b', '').strip()
            flags.append(f"vague_claim: unsupported statement found ({clean_pattern})")
            break  # One flag is enough

    return flags


# ─── JSON Parser ──────────────────────────────────────────────────────────────

def _parse_json_response(raw: str) -> dict | None:
    """Robust JSON extraction from LLM response."""
    # Try direct parse first
    try:
        return json.loads(raw.strip())
    except json.JSONDecodeError:
        pass

    # Find JSON block
    start = raw.find("{")
    end   = raw.rfind("}") + 1
    if start == -1 or end == 0:
        log.warning("QA: No JSON found in response. Raw: %s", raw[:200])
        return None

    try:
        return json.loads(raw[start:end])
    except json.JSONDecodeError as e:
        log.warning("QA: JSON parse error: %s | Raw slice: %s", e, raw[start:start+200])
        return None


def _default_scores() -> dict:
    return {k: 70 for k in SCORE_WEIGHTS}


# ─── Agent Entry Point ────────────────────────────────────────────────────────

async def run(
    content:      str,
    brand_profile: dict | None = None,
    seo_enabled:  bool         = False,
    seo_settings: dict         = None,
) -> dict:
    """
    Perform QA analysis on content.

    Returns comprehensive quality scores, flags, and pass/fail determination.
    """
    # ── Prepare inputs ────────────────────────────────────────────────────────
    brand          = brand_profile or {}
    brand_name     = brand.get("name", "Not specified")
    banned_phrases = brand.get("banned_phrases") or []
    key_messages   = brand.get("key_messages")   or []
    compliance     = brand.get("compliance_notes") or "None"

    # The profile facts QA has to check the content against. Without these
    # QA could score voice and structure but had no way to tell an invented
    # career from a real one.
    profile_facts = (brand.get("document_context") or "").strip()
    identity_bits = [
        f"{label}: {brand.get(key)}"
        for label, key in (
            ("Brand/Person", "name"),
            ("Industry",     "industry"),
            ("Positioning",  "positioning"),
            ("Mission",      "mission"),
            ("Life purpose", "life_purpose"),
        )
        if brand.get(key)
    ]
    verified_facts = "\n".join(identity_bits)
    if profile_facts:
        verified_facts = (verified_facts + "\n\n" + profile_facts).strip()

    _RULE = "-------------------------------------------------------"

    if verified_facts:
        grounding_context = (
            "VERIFIED PROFILE FACTS (the only support for first-person "
            "claims about the author):\n"
            f"{_RULE}\n"
            f"{verified_facts[:6000]}\n"
            f"{_RULE}\n"
            "Any claim about the author that is absent above is fabricated. "
            "Flag it and score groundingScore accordingly."
        )
    else:
        grounding_context = (
            "NO VERIFIED PROFILE SUPPLIED.\n"
            "Therefore ANY first-person claim about the author's experience, "
            "role, employer, projects or history is unsupported. Flag each one "
            "and score groundingScore on how well the content avoids them."
        )

    # SEO keyword for local check
    seo_keyword = None
    seo_block   = ""
    if seo_enabled and seo_settings:
        seo_keyword = seo_settings.get("primaryKeyword")
        if seo_keyword:
            seo_block = f"\nSEO CHECK: Verify primary keyword \"{seo_keyword}\" appears naturally (not stuffed)."

    # ── LLM QA ───────────────────────────────────────────────────────────────
    user_prompt = USER_TEMPLATE.format(
        content=content[:4000],   # Truncate very long content for QA
        brand_name=brand_name,
        banned_phrases=(
            ", ".join(banned_phrases[:20]) if banned_phrases
            else "None specified"
        ),
        key_messages=(
            "\n".join(f"• {m}" for m in key_messages[:5]) if key_messages
            else "None specified"
        ),
        compliance_notes=compliance,
        seo_block=seo_block,
        grounding_context=grounding_context,
    )

    raw, tokens = await complete(
        SYSTEM,
        user_prompt,
        temperature=0.2,    # Low temperature for consistency
        max_tokens=800,
    )

    # ── Parse response ────────────────────────────────────────────────────────
    scores = _parse_json_response(raw)

    if scores is None:
        log.error("QA: Failed to parse LLM response — using defaults")
        scores = _default_scores()
        scores.update({
            "flags":       ["qa_parse_failed"],
            "suggestions": ["QA parsing failed — manual review recommended"],
            "summary":     "QA analysis incomplete — using default scores",
        })

    # ── Local deterministic analysis ──────────────────────────────────────────
    local_flags = _local_analysis(content, banned_phrases, seo_keyword)

    # Merge flags (dedup)
    llm_flags   = scores.get("flags", [])
    all_flags   = list(dict.fromkeys(llm_flags + local_flags))

    # ── Calculate overall score ───────────────────────────────────────────────
    overall = _compute_weighted_score(scores)

    # ── Pass/fail determination ───────────────────────────────────────────────
    passed = _determine_pass(overall, scores, all_flags)

    log.info(
        "QA complete | overall=%d | passed=%s | flags=%d | tokens=%d",
        overall, passed, len(all_flags), tokens,
    )

    return {
        # Individual scores
        "readabilityScore":  scores.get("readabilityScore",  70),
        "brandScore":        scores.get("brandScore",        70),
        "structureScore":    scores.get("structureScore",    70),
        "platformScore":     scores.get("platformScore",     70),
        "humanizationScore": scores.get("humanizationScore", 70),
        "consistencyScore":  scores.get("consistencyScore",  70),
        "clarityScore":      scores.get("clarityScore",      70),
        "engagementScore":   scores.get("engagementScore",   70),
        "ctaScore":          scores.get("ctaScore",          50),
        "groundingScore":    scores.get("groundingScore",    70),
        # Composite
        "overallScore":      overall,
        "passed":            passed,
        "flags":             all_flags,
        "suggestions":       scores.get("suggestions", []),
        "summary":           scores.get("summary", ""),
        "tokensUsed":        tokens,
        "agent":             "qa",
        "weights":           SCORE_WEIGHTS,
    }