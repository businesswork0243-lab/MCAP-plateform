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
import os
import re
import logging
from collections import Counter
from services.llm import complete
from services import format_specs

log = logging.getLogger("ai-engine.qa")

SYSTEM = """You are a senior editorial QA specialist. Analyze content and return a STRICTLY VALID JSON assessment.
Be precise, objective, and consistent. Flag concrete, fixable issues only.
Do not invent flags. RESPOND WITH JSON ONLY — no other text before or after."""

# ─── Prompt Template ──────────────────────────────────────────────────────────

USER_TEMPLATE = """Perform a comprehensive editorial QA review of this content.

CONTENT:
{content}

{platform_block}CONTEXT:
- Brand: {brand_name}
- Brand Banned Phrases: {banned_phrases}
- Key Messages to Check: {key_messages}
- Compliance Notes: {compliance_notes}
{seo_block}

{grounding_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCALE (applies to every dimension):
  90-100  publishable as it stands; you could not name an edit
  75-89   good; a light edit would improve it
  60-74   acceptable, with weaknesses a reader would notice
  40-59   significant problems
  below 40  broken or unusable
Most competent drafts land between 65 and 85. Use the whole scale. Any score below
75 needs a matching entry in flags or suggestions that quotes the sentence at fault.

SCORING DIMENSIONS (rate 0-100 each):

1. readabilityScore    — sentence variety, flow, paragraph structure, accessibility
2. brandScore         — brand voice, terminology, banned phrase compliance
3. structureScore     — one clear thesis, logical flow, argument coherence,
                        every paragraph advancing the argument
4. platformScore      — fit to THIS format (named above): its length, its
                        conventions, and what readers of that channel expect
5. humanizationScore  — naturalness, absence of AI clichés, authentic voice
6. consistencyScore   — consistent tone, tense, perspective, terminology
7. clarityScore       — precise language; concrete specifics instead of
                        vague gestures; unambiguous claims
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
- fabricated_metric: a number, percentage, benchmark or scale figure with no source
  in the brand material, and any study, institution or named person "found" something
- fabricated_event: an anecdote or case told as fact that the brand material does not contain
  (a scenario clearly framed as hypothetical, such as "Picture a team that...", is fine)
Start each such flag with its exact label, for example "fabricated_metric: ...".
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

QA_FACTS_CHARS     = int(os.getenv("BRAND_DOC_CHARS_QA", "12000"))
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
    "unsourced statistic",
    "vague attribution",
    "fabricated or unsourced",
    "banned_phrase",
    "content_too_short",
    "structural_gap",
    "fabricated_experience",
    "fabricated_metric",
    "fabricated_event",
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
    platform:       str | None = None,
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

    # 4. Too short, measured against what this format is meant to be. A
    # 40-word X post is complete; a 40-word article is not.
    word_count = len(words)
    floor = 50
    if platform:
        spec = format_specs.get_spec(platform)
        floor = int(spec.min_words * 0.5) if spec.min_words else 8
    if word_count < floor:
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


# ─── Metric flag reconciliation ───────────────────────────────────────────────

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
_FLAG_QUOTE = re.compile(r"^fabricated_metric:\s*(.*?)(?:\s[—–-]\s|$)", re.S | re.I)


def _in_material(number: str, material: str) -> bool:
    n = number.replace(",", "").rstrip(".")
    pattern = r"(?<![\d.])" + re.escape(n) + r"(?![\d])"
    return bool(re.search(pattern, material))


def _reconcile_metric_flags(flags: list[str], material: str) -> list[str]:
    """Keep `fabricated_metric` for numbers the brand material does not contain.

    The label is on the critical list, so one such flag fails the piece whatever
    its score. The model used it for wording nits too: the same correct draft was
    failed in three of four runs over "FY2025-26" against "FY2026", a label the
    brand document itself uses. Whether a figure appears in the material is a
    lookup, not a judgement, so it is decided here. A flag whose quoted figures
    all appear in the material becomes a warning about wording.
    """
    if not material.strip():
        return flags
    norm = material.replace(",", "")
    out: list[str] = []
    for flag in flags:
        m = _FLAG_QUOTE.match(flag.strip()) if flag.lower().lstrip().startswith("fabricated_metric") else None
        quoted = m.group(1) if m else ""
        numbers = _NUMBER.findall(quoted)
        if numbers and all(_in_material(n, norm) for n in numbers):
            # The model's explanation is dropped: it is the reading that was just
            # shown to be wrong ("not in the brand document"), and repeating it
            # beside "the figures appear in the brand material" contradicts it.
            out.append(
                f"metric_wording: {quoted.strip()} - the figures appear in the brand material; "
                "check the label or wording"
            )
        else:
            out.append(flag)
    return out


# ─── Critical-flag triage ─────────────────────────────────────────────────────

# The model's critical flags were an opinion with nothing behind them, and the
# same clean draft failed three times in four over them: a figure "not in the
# profile" that was, a phrase the document uses word for word, a banned phrase
# the flag itself said was absent, a flag ending "so this is supported". A flag
# can fail a piece only when something other than that one reading stands behind
# it. The rest become warnings.
#
#   fabricated_experience  critical always: invented experience must never ship
#   banned phrase          critical only if a banned phrase is in the text
#   fabricated_metric      critical if a quoted figure is missing from the material
#                          (see _reconcile_metric_flags); otherwise needs the audit
#   anything else critical critical only if the claim audit, which reads the whole
#                          document, points at the same sentence
_CONCESSIONS = (
    "not a flag", "this is supported", "is supported", "so supported",
    "none present", "is not used", "not a specific fabricated", "vague but",
)
_ALWAYS_CRITICAL = ("fabricated_experience", "content_too_short", "structural_gap")
_WORD = re.compile(r"[a-z0-9']+")


def _flag_subject(flag: str) -> str:
    body = flag.split(":", 1)[1] if ":" in flag else flag
    for sep in (" — ", " – ", " - "):
        if sep in body:
            body = body.split(sep, 1)[0]
            break
    return body.strip(" \"'‘’“”")


def _squash(text: str) -> str:
    text = re.sub(r"[–—]", "-", text.lower())
    text = re.sub(r"[‘’“”]", "'", text)
    return re.sub(r"\s+", " ", text).strip()


def _same_sentence(a: str, b: str) -> bool:
    wa, wb = set(_WORD.findall(a.lower())), set(_WORD.findall(b.lower()))
    if not wa or not wb:
        return False
    return len(wa & wb) / min(len(wa), len(wb)) >= 0.7


def _soften(flag: str, label: str) -> str:
    return label + ": " + re.sub(r"(?i)fabricat\w*", "flagged", flag.split(":", 1)[-1].strip())


def _triage_critical_flags(
    flags:      list[str],
    claims:     list[dict] | None,
    audit_ran:  bool,
    content:    str = "",
    banned:     list[str] | None = None,
    material:   str = "",
) -> list[str]:
    """Keep a critical flag only when something besides one model reading backs it."""
    out: list[str] = []
    text = content.lower()
    material_sq = _squash(material)
    for flag in flags:
        low = flag.lower()
        if _count_critical_flags([flag]) == 0:
            out.append(flag)
            continue
        if any(low.lstrip().startswith(lbl) for lbl in _ALWAYS_CRITICAL):
            out.append(flag)
            continue
        if any(c in low for c in _CONCESSIONS):
            out.append(_soften(flag, "flag_withdrawn"))
            continue
        if "banned_phrase" in low or "banned phrase" in low:
            present = any(b.lower() in text for b in (banned or []) if b)
            out.append(flag if present else _soften(flag, "flag_withdrawn"))
            continue

        subject = _flag_subject(flag)
        if low.startswith("fabricated_metric") and _NUMBER.search(subject):
            # Reached only when a quoted figure is missing from the material.
            out.append(flag)
            continue
        if len(subject) >= 12 and material_sq and _squash(subject) in material_sq:
            out.append(_soften(flag, "flag_withdrawn"))   # the document says it word for word
            continue
        if not audit_ran:
            out.append(flag)                              # no second opinion exists
        elif any(_same_sentence(subject, c["sentence"]) for c in (claims or [])):
            out.append(flag)
        else:
            out.append(_soften(flag, "unconfirmed_claim"))
    return out


# ─── Claim audit ──────────────────────────────────────────────────────────────

# A claim that is plausible and wrong passes every rule that only looks at the
# draft: "the directory's revenue depends on advertising" is grammatical, on
# brand and absent from the brand document. Finding it means reading the draft
# against the whole document, so this gets the document at full length.
CLAIM_AUDIT_ENABLED = os.getenv("QA_CLAIM_AUDIT", "1") != "0"
CLAIM_AUDIT_DOC_CHARS = int(os.getenv("QA_CLAIM_AUDIT_DOC_CHARS", "40000"))
CLAIM_AUDIT_MIN_DOC_CHARS = 400

CLAIM_AUDIT_SYSTEM = (
    "You compare a draft against a brand document and report claims the document does not support. "
    "Return JSON only."
)

CLAIM_AUDIT_TEMPLATE = """BRAND DOCUMENT:
{document}

DRAFT:
{content}

List the sentences of the DRAFT that introduce a NEW fact about this brand which the document does not state: \
an event, a past action, a number, a cause, a motive, a decision, a customer, or a source of revenue. \
Examples of what to list: "Discovery paid the bills" (a revenue claim the document never makes), \
"we optimized the menu PDF" (an invented past action), "the directory's revenue depends on advertising" \
(a revenue model the document never describes).

Do NOT list a sentence that paraphrases, summarises or re-frames what the document states, that draws a \
conclusion from stated facts, that uses an analogy or emphasis, that gives advice, asks a question or states \
an opinion, or that reasons about the industry without asserting something new about this brand. \
A different wording of a stated fact is supported.

List at most 5, the most serious first. Quote each sentence exactly and say in under 20 words what new fact it asserts.
Return ONLY: {{"unsupported": [{{"sentence": "...", "reason": "..."}}]}}  (an empty list if every claim is supported)"""


async def _audit_claims(content: str, document: str) -> tuple[list[dict], int]:
    """Brand-specific claims in the draft that the document does not support."""
    raw, tokens = await complete(
        CLAIM_AUDIT_SYSTEM,
        CLAIM_AUDIT_TEMPLATE.format(document=document[:CLAIM_AUDIT_DOC_CHARS], content=content[:14000]),
        temperature=0.0,
        max_tokens=900,
    )
    data = _parse_json_response(raw or "") or {}
    items = data.get("unsupported") if isinstance(data, dict) else None
    claims: list[dict] = []
    for item in items or []:
        if isinstance(item, dict) and str(item.get("sentence", "")).strip():
            claims.append({"sentence": str(item["sentence"]).strip()[:300],
                           "reason": str(item.get("reason", "")).strip()[:200]})
    return claims[:5], tokens


# ─── Agent Entry Point ────────────────────────────────────────────────────────

async def run(
    content:      str,
    brand_profile: dict | None = None,
    seo_enabled:  bool         = False,
    seo_settings: dict         = None,
    platform:     str | None   = None,
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
    # What the prompt shows may be a condensed brief. Lookups, the claim audit
    # and the rhythm measurement need the document as uploaded.
    from services.verified_facts import source_document
    full_document = source_document(brand).strip()
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
    # Figure lookups and flag triage use the whole document, not the prompt's excerpt.
    lookup_material = "\n".join(identity_bits)
    if full_document:
        lookup_material = (lookup_material + "\n\n" + full_document).strip()

    _RULE ="-------------------------------------------------------"

    if verified_facts:
        grounding_context = (
            "VERIFIED PROFILE FACTS (the only support for first-person "
            "claims about the author):\n"
            f"{_RULE}\n"
            f"{verified_facts[:QA_FACTS_CHARS]}\n"
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
    format_issues: list[str] = []
    platform_block = ""
    if platform:
        spec = format_specs.get_spec(platform)
        format_issues = format_specs.check(platform, content)
        platform_block = (
            f"FORMAT: this piece is a {spec.name} ({spec.length_label}). "
            "Score platformScore against that format.\n"
        )
        if format_issues:
            platform_block += (
                "Measured format problems (already confirmed by code): "
                + "; ".join(format_issues) + "\n"
            )
        platform_block += "\n"

    # 4000 characters cut a 1,500-word article in half, so QA scored the first
    # half and called it the piece.
    user_prompt = USER_TEMPLATE.format(
        platform_block=platform_block,
        content=content[:14000],
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
        max_tokens=1200,
    )

    # ── Parse response ────────────────────────────────────────────────────────
    scores = _parse_json_response(raw)

    if scores is None:
        # A truncated or malformed answer deserves one more try before QA
        # gives up on the piece.
        log.warning("QA: unparseable response, retrying once")
        raw, retry_tokens = await complete(
            SYSTEM,
            user_prompt + chr(10) * 2 + "Return the JSON object only. Keep flags and suggestions short.",
            temperature=0.0,
            max_tokens=1500,
        )
        tokens += retry_tokens
        scores = _parse_json_response(raw)

    if scores is None:
        # The old fallback scored every dimension 70, which is exactly the pass
        # mark, so a QA call that failed twice approved the piece. Unscored is
        # reported as unscored.
        log.error("QA: Failed to parse LLM response twice - piece left unscored")
        return {
            "overallScore":  0,
            "passed":        False,
            "flags":         ["qa_unscored: the quality check could not be completed"],
            "suggestions":   ["Run QA again before publishing"],
            "summary":       "QA could not score this piece.",
            "tokensUsed":    tokens,
            "agent":         "qa",
            "weights":       SCORE_WEIGHTS,
            "error":         "qa_unparseable",
        }

    # ── Local deterministic analysis ──────────────────────────────────────────
    local_flags = _local_analysis(content, banned_phrases, seo_keyword, platform)

    # Format problems are measured, not opinions, so they are reported as such
    # and cap the platform score: a 312-character X post cannot be a 90 on fit.
    for issue in format_issues:
        local_flags.append(f"format: {issue}")
    if format_issues:
        scores["platformScore"] = min(scores.get("platformScore", 70), 65)
    if format_specs._PLACEHOLDER.search(content):
        local_flags.append("needs_input: replace the bracketed placeholder before publishing")

    # A figure the brand material contains is not fabricated, whatever the
    # model called it. Checked against the whole document, not the excerpt.
    llm_flags = _reconcile_metric_flags(scores.get("flags", []), lookup_material)

    # Claims the document does not support, found by reading the draft against
    # the whole document. Warnings, not failures: they are a model's reading and
    # a wrong one must not block a correct piece the way the metric flag did.
    claim_audit = None
    audit_flags: list[str] = []
    if CLAIM_AUDIT_ENABLED and len(full_document) >= CLAIM_AUDIT_MIN_DOC_CHARS:
        try:
            unsupported, audit_tokens = await _audit_claims(content, full_document)
            tokens += audit_tokens
            claim_audit = {"checked": True, "unsupported": unsupported}
            for c in unsupported:
                reason = re.sub(r"(?i)fabricat\w*", "unsupported", c["reason"] or "not found in the brand document")
                audit_flags.append(f"unverified_claim: \"{c['sentence']}\" - {reason}")
        except Exception as e:  # pragma: no cover - the audit must never fail a run
            log.warning("QA claim audit skipped (non-fatal): %s", e)
            claim_audit = {"checked": False, "unsupported": []}

    # Critical flags that contradict themselves, or rest on one reading of a
    # story with no second opinion, are warnings. Invented experience and
    # figures missing from the material stay critical.
    llm_flags = _triage_critical_flags(
        llm_flags,
        (claim_audit or {}).get("unsupported"),
        bool(claim_audit and claim_audit["checked"]),
        content=content,
        banned=banned_phrases,
        material=lookup_material,
    )
    llm_flags.extend(audit_flags)

    # Merge flags (dedup)
    all_flags   = list(dict.fromkeys(llm_flags + local_flags))

    # ── Calculate overall score ───────────────────────────────────────────────
    overall = _compute_weighted_score(scores)

    # ── Pass/fail determination ───────────────────────────────────────────────
    passed = _determine_pass(overall, scores, all_flags)

    # ── Writing report (advisory, no LLM, no weight) ──────────────────────────
    # Deliberately kept out of `overall` and out of `passed`. Grounding blocks
    # because it is about truth; this is about taste, and the doc's own
    # recommendation was to warn rather than block. Adding weight here would
    # also silently restate every score already in the database.
    writing_report = None
    voice_report = None
    try:
        from services.structure import score as structure_score
        writing_report = structure_score(content)
    except Exception as e:  # pragma: no cover - reporting must not fail a run
        log.warning("Writing report unavailable (non-fatal): %s", e)

    try:
        from services.voice import measure, distance
        brand_voice = measure(full_document)
        voice_report = distance(brand_voice, content)
    except Exception as e:  # pragma: no cover
        log.warning("Voice match unavailable (non-fatal): %s", e)

    log.info(
        "QA complete | overall=%d | passed=%s | flags=%d | tokens=%d | "
        "writing=%s | voice_match=%s",
        overall, passed, len(all_flags), tokens,
        (writing_report or {}).get("score"),
        (voice_report or {}).get("match"),
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
        # Advisory. `writingScore` is the structural reading and `voiceMatch`
        # is how close the draft sits to the brand's measured rhythm. Neither
        # is in `overallScore` and neither can fail a piece. Both are null when
        # the text is too short to read, rather than a number that looks
        # meaningful and is not.
        "writingScore":      (writing_report or {}).get("score"),
        "writingReport":     writing_report,
        "voiceMatch":        (voice_report or {}).get("match"),
        "voiceReport":       voice_report,
        "flags":             all_flags,
        "claimAudit":        claim_audit,
        "suggestions":       scores.get("suggestions", []),
        "summary":           scores.get("summary", ""),
        "tokensUsed":        tokens,
        "agent":             "qa",
        "weights":           SCORE_WEIGHTS,
    }