"""
Prompt Compilation Layer — PDL (Prompt Definition Language)

Merges user intent + brand profile + ICP + tonality + SEO
into structured per-agent instructions.
"""
from dataclasses import dataclass, field
from typing import Optional


# ─── PDL Request ─────────────────────────────────────────────────────────────

@dataclass
class PDLRequest:
    """All inputs the user can specify — maps to content wizard fields."""

    # Core
    topic:     str
    objective: str = "Build thought leadership"

    # Audience
    audience:        str = "General Business"
    icp_description: str = ""
    perspective:     str = "Founder"

    # Structure
    writing_structure:    str = "thesis"
    custom_structure_flow: Optional[list[str]] = None
    # If set, overrides writing_structure lookup

    # Platforms
    platforms: list[str] = field(default_factory=lambda: ["linkedin_post"])

    # Language & Style
    language:      str = "English"
    reading_level: str = "Professional"

    # Context
    context:              str = ""
    special_instructions: str = ""
    keywords:             list[str] = field(default_factory=list)

    # CTA
    cta: str = ""

    # Brand
    brand_profile: Optional[dict] = None

    # Tonality Spectrum (per-piece emotional settings)
    tonality_spectrum: dict = field(default_factory=dict)
    # e.g. {"angry": 0, "excited": 7, "confident": 8, "serious": 6}

    # Word count (for blog/long-form)
    word_count: Optional[int] = None

    # SEO
    seo_enabled:  bool = False
    seo_settings: dict = field(default_factory=dict)
    # e.g. {"primaryKeyword": "...", "secondaryKeywords": [...]}

    # Pipeline settings
    enable_humanization:    bool = True
    humanization_intensity: str  = "medium"
    enable_qa:              bool = True
    require_approval:       bool = False


@dataclass
class CompiledPromptPackage:
    """Structured instructions for each downstream agent."""
    canonical_instructions:    dict
    platform_instructions:     dict  # keyed by platform id
    brand_instructions:        dict
    humanization_instructions: dict
    qa_instructions:           dict
    metadata:                  dict

# ─── Reference Tables ─────────────────────────────────────────────────────────

ICP_EMPHASIS = {
    "C-Suite / Executives": {
        "emphasis": "strategic implications, business risk, and ROI",
        "avoid":    "technical implementation details",
        "tone_note":"Executive-level framing — decisions, outcomes, accountability",
    },
    "Technical (CTO, Engineers)": {
        "emphasis": "architecture, performance trade-offs, implementation specifics",
        "avoid":    "generic business fluff",
        "tone_note":"Technical depth expected — precision over simplification",
    },
    "Investors / VCs": {
        "emphasis": "market differentiation, defensibility, adoption risks, return potential",
        "avoid":    "operational minutiae",
        "tone_note":"Frame through market opportunity and risk",
    },
    "Policymakers": {
        "emphasis": "privacy implications, compliance, governance impact",
        "avoid":    "commercial positioning",
        "tone_note":"Neutral, evidence-based, policy-oriented framing",
    },
    "Marketing Professionals": {
        "emphasis": "audience engagement, messaging effectiveness, campaign applicability",
        "avoid":    "deep technical specs",
        "tone_note":"Practical, creative, results-oriented",
    },
    "Founders / Entrepreneurs": {
        "emphasis": "execution insights, growth lessons, builder mindset",
        "avoid":    "academic theory",
        "tone_note":"Raw, honest, founder-to-founder voice",
    },
    "General Business": {
        "emphasis": "practical takeaways and broader business implications",
        "avoid":    "excessive jargon",
        "tone_note":"Accessible but substantive",
    },
}

CTA_TEMPLATES = {
    "invite_discussion": "End with an open question inviting readers to share their perspective.",
    "newsletter":        "Close with a soft invitation to subscribe for more insights.",
    "book_consultation": "Include a brief CTA to schedule a consultation or discovery call.",
    "download_resource": "Reference a downloadable resource (whitepaper, guide, checklist).",
    "register_event":    "Mention an upcoming event and invite registration.",
    "comment":           "Ask readers to comment with their thoughts or experience.",
    "share":             "Encourage readers to share this with someone who needs to see it.",
    "follow":            "Invite readers to follow for more content like this.",
    "visit_website":     "Direct readers to your website for more information.",
    "book_call":         "Invite readers to book a call to discuss further.",
    "download":          "Point readers to a free downloadable resource.",
    "subscribe":         "Ask readers to subscribe to your newsletter.",
    "none":              "No explicit CTA — let the content speak for itself.",
    "no_cta":            "No explicit CTA — let the content speak for itself.",
}

PERSPECTIVE_VOICE = {
    "Founder":        "first-person founder voice — personal conviction, hard-won lessons, strategic clarity",
    "CEO":            "authoritative executive voice — vision, accountability, direction",
    "CMO / Marketing":"brand-savvy, audience-centric — positioning and market narrative",
    "CTO / Technical":"technical authority — architecture decisions, engineering trade-offs",
    "Researcher":     "evidence-driven academic voice — data, methodology, measured conclusions",
    "Analyst":        "objective analyst — trends, patterns, implications",
    "Consultant":     "advisory voice — frameworks, recommendations, structured problem-solving",
    "Expert":         "subject matter expert — deep knowledge, authoritative but accessible",
    "Educator":       "teaching voice — clear explanations, examples, building understanding",
    "Thought Leader": "visionary voice — forward-looking, challenging conventions",
    "Brand":          "collective institutional voice — we, our, organizational perspective",
}

TONALITY_DESCRIPTIONS = {
    "angry":      "Righteous anger — the writing should feel indignant about an injustice or problem",
    "frustrated": "Mild exasperation — the tone carries visible frustration with the status quo",
    "excited":    "Genuine enthusiasm — the energy and excitement should be palpable",
    "confident":  "Unshakeable certainty — authoritative, declarative, no hedging",
    "curious":    "Exploring tone — asking questions, wondering, inviting reader to think",
    "empathetic": "Deep understanding — the writer clearly feels the reader's pain or situation",
    "playful":    "Light, humorous — don't take everything too seriously",
    "serious":    "Gravity and weight — this topic deserves full seriousness",
}


# ─── Main Compiler ────────────────────────────────────────────────────────────

def compile(req: PDLRequest) -> CompiledPromptPackage:
    """Merge all inputs into structured per-agent instructions."""

    icp = ICP_EMPHASIS.get(req.audience, ICP_EMPHASIS["General Business"])

    # CTA resolution
    cta_key = req.cta.lower().replace(" ", "_").replace("-", "_")
    cta_instruction = CTA_TEMPLATES.get(cta_key, req.cta or CTA_TEMPLATES["none"])

    # Perspective voice
    perspective_voice = PERSPECTIVE_VOICE.get(req.perspective, req.perspective)

    # Brand profile fields
    brand           = req.brand_profile or {}
    brand_name      = brand.get("name", "")
    tone_settings   = brand.get("tone_settings") or brand.get("tone") or {}
    banned_phrases  = brand.get("banned_phrases") or []
    preferred_terms = brand.get("preferred_terms") or []
    key_messages    = brand.get("key_messages") or []
    compliance_notes= brand.get("compliance_notes") or ""

    # New brand fields
    likes            = brand.get("likes") or []
    hates            = brand.get("hates") or []
    dislikes         = brand.get("dislikes") or []
    stands_for       = brand.get("stands_for") or []
    stands_against   = brand.get("stands_against") or []
    core_values      = brand.get("core_values") or []
    core_motivations = brand.get("core_motivations") or []
    life_purpose     = brand.get("life_purpose") or ""

    # Tonality instructions
    tonality_block = _build_tonality_block(req.tonality_spectrum)

    # Word count instruction
    word_count_instruction = ""
    if req.word_count:
        word_count_instruction = f"Target word count: approximately {req.word_count} words."

    # SEO instruction
    seo_block = _build_seo_block(req.seo_enabled, req.seo_settings)

    # Context block
    context_block = _build_context_block(req, icp)

    # ── Canonical Writer ─────────────────────────────────────────────────────
    canonical_instructions = {
        "topic":               req.topic,
        "objective":           req.objective,
        "context":             context_block,
        "audience":            req.audience,
        "icp_emphasis":        icp["emphasis"],
        "icp_avoid":           icp["avoid"],
        "perspective":         req.perspective,
        "perspective_voice":   perspective_voice,
        "structure":           req.writing_structure,
        "custom_structure_flow": req.custom_structure_flow,
        "cta":                 cta_instruction,
        "language":            req.language,
        "reading_level":       req.reading_level,
        "keywords":            req.keywords,
        "special_instructions": _merge_special_instructions(
            req.special_instructions,
            tonality_block,
            word_count_instruction,
            seo_block,
        ),
        "tonality_spectrum":   req.tonality_spectrum,
        "word_count":          req.word_count,
        "seo_enabled":         req.seo_enabled,
        "seo_settings":        req.seo_settings,
        # ✅ NEW: Brand document context canonical writer ko bhi milna chahiye
        "brand_document_context": brand.get("document_context") or "",
    }

    # ── Platform instructions ────────────────────────────────────────────────
    platform_instructions = {
        platform: {
            "platform":      platform,
            "audience_note": icp["tone_note"],
            "cta":           cta_instruction,
            "word_count":    req.word_count,
            "seo_enabled":   req.seo_enabled,
            "seo_settings":  req.seo_settings,
        }
        for platform in req.platforms
    }

    # ── Brand instructions ───────────────────────────────────────────────────
    brand_instructions = {
        "brand_name":       brand_name,
        "mission":          brand.get("mission_statement") or brand.get("missionStatement") or brand.get("mission") or "",
        "life_purpose":     life_purpose,
        "tone_settings":    tone_settings,
        "banned_phrases":   banned_phrases,
        "preferred_terms":  preferred_terms,
        "key_messages":     key_messages,
        "compliance_notes": compliance_notes,
        # Values & Beliefs
        "likes":            likes,
        "hates":            hates,
        "dislikes":         dislikes,
        "stands_for":       stands_for,
        "stands_against":   stands_against,
        "core_values":      core_values,
        "core_motivations": core_motivations,
        # ✅ NEW: Document context pass karo
        "document_context": brand.get("document_context") or brand.get("doc_context") or "",
        "has_documents":    brand.get("has_documents", False),
    }

    # ── Humanization instructions ────────────────────────────────────────────
    humanization_instructions = {
        "enabled":           req.enable_humanization,
        "intensity":         req.humanization_intensity,
        "language":          req.language,
        "audience_register": icp["tone_note"],
        "tonality":          req.tonality_spectrum,
    }

    # ── QA instructions ──────────────────────────────────────────────────────
    qa_instructions = {
        "enabled":          req.enable_qa,
        "brand_profile":    req.brand_profile,
        "audience":         req.audience,
        "platform_targets": req.platforms,
        "require_approval": req.require_approval,
        "seo_enabled":      req.seo_enabled,
    }

    # ── Metadata ─────────────────────────────────────────────────────────────
    metadata = {
        "topic":                  req.topic,
        "objective":              req.objective,
        "audience":               req.audience,
        "perspective":            req.perspective,
        "structure":              req.writing_structure,
        "custom_structure":       bool(req.custom_structure_flow),
        "platforms":              req.platforms,
        "brand":                  brand_name,
        "humanization_intensity": req.humanization_intensity,
        "language":               req.language,
        "cta":                    req.cta,
        "word_count":             req.word_count,
        "seo_enabled":            req.seo_enabled,
        "tonality_active":        [k for k, v in req.tonality_spectrum.items() if v >= 6],
    }

    return CompiledPromptPackage(
        canonical_instructions=canonical_instructions,
        platform_instructions=platform_instructions,
        brand_instructions=brand_instructions,
        humanization_instructions=humanization_instructions,
        qa_instructions=qa_instructions,
        metadata=metadata,
    )


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _build_tonality_block(tonality: dict) -> str:
    """Build human-readable tonality instruction from spectrum values."""
    if not tonality:
        return ""

    active = sorted(
        [(k, v) for k, v in tonality.items() if v >= 5],
        key=lambda x: x[1],
        reverse=True,
    )

    if not active:
        return ""

    lines = ["TONALITY SPECTRUM FOR THIS PIECE:"]
    for tone, value in active:
        desc = TONALITY_DESCRIPTIONS.get(tone, tone)
        intensity = "HIGH" if value >= 8 else "MEDIUM" if value >= 6 else "MILD"
        lines.append(f"  • {tone.upper()} ({value}/10 — {intensity}): {desc}")

    lines.append("Let these emotional tones guide word choice and sentence rhythm naturally.")
    return "\n".join(lines)


def _build_seo_block(enabled: bool, settings: dict) -> str:
    """Build SEO instruction block."""
    if not enabled or not settings:
        return ""

    lines = ["SEO REQUIREMENTS:"]
    if pk := settings.get("primaryKeyword"):
        lines.append(f"  • Primary keyword: \"{pk}\" (use in title, first paragraph, and 2-3 times naturally)")
    if sk := settings.get("secondaryKeywords"):
        if isinstance(sk, list) and sk:
            lines.append(f"  • Secondary keywords: {', '.join(sk)}")
    if md := settings.get("metaDescription"):
        lines.append(f"  • Target meta description: \"{md}\"")

    lines.extend([
        "  • Use proper H2/H3 heading structure",
        "  • Write SEO-friendly introduction (keyword in first 100 words)",
        "  • Avoid keyword stuffing — natural integration only",
    ])

    return "\n".join(lines)


def _build_context_block(req: PDLRequest, icp: dict) -> str:
    """Build rich context block for canonical writer."""
    parts = []

    if req.context:
        parts.append(f"USER-PROVIDED CONTEXT:\n{req.context}")

    if req.icp_description:
        parts.append(f"AUDIENCE PROFILE:\n{req.icp_description}")

    parts.append(f"AUDIENCE EMPHASIS: {icp['emphasis']}")
    parts.append(f"AVOID IN THIS PIECE: {icp['avoid']}")

    if req.keywords:
        parts.append(f"KEYWORDS TO WEAVE IN NATURALLY: {', '.join(req.keywords)}")

    # Brand values context (for canonical voice)
    brand = req.brand_profile or {}
    if brand.get("life_purpose"):
        parts.append(f"BRAND PURPOSE: {brand['life_purpose']}")
    if brand.get("stands_for"):
        parts.append(f"BRAND STANDS FOR: {', '.join(brand['stands_for'])}")
    if brand.get("stands_against"):
        parts.append(f"BRAND STANDS AGAINST: {', '.join(brand['stands_against'])}")
    if brand.get("core_values"):
        parts.append(f"CORE VALUES: {', '.join(brand['core_values'])}")

    return "\n\n".join(parts) if parts else "No additional context provided."


def _merge_special_instructions(*parts: str) -> str:
    """Merge multiple instruction blocks into one."""
    merged = [p.strip() for p in parts if p and p.strip()]
    return "\n\n".join(merged) if merged else ""
