"""What the brand has actually told us about itself.

Grounding rules (SR014-SR016) ask whether a first-person claim is supported.
That question has no answer unless the checker can see the support, and the
rule engine used to receive only the draft. Every "we" sentence was therefore
read as invented, drafts were sent back for rewrites they did not need, and the
writer learned that the safe move was to avoid first person altogether.
"""
from __future__ import annotations

import os

_NL = chr(10)

# The uploaded document is the richest source and also the longest. A 15-page
# brand report is about 37,000 characters; at 6,000 the checker saw the first
# sixth and called anything from the rest unsupported or, worse, never noticed
# it was unsupported. Configurable because the right size is a cost decision.
DOCUMENT_CHARS = int(os.getenv("BRAND_DOC_CHARS_VALIDATOR", "20000"))


def build_verified_facts(profile: dict | None) -> str:
    """The brand profile's structured fields, one per line."""
    if not profile:
        return ""
    lines: list[str] = []
    for label, key in (
        ("Name",         "name"),
        ("Industry",     "industry"),
        ("Website",      "website"),
        ("Positioning",  "positioning"),
        ("Mission",      "mission"),
        ("Vision",       "vision"),
        ("Life purpose", "life_purpose"),
        ("Description",  "description"),
    ):
        val = profile.get(key)
        if val:
            lines.append(f"{label}: {val}")

    for label, key in (
        ("Key messages",       "key_messages"),
        ("Value propositions", "value_propositions"),
        ("Core values",        "core_values"),
        ("Stands for",         "stands_for"),
        ("Stands against",     "stands_against"),
    ):
        val = profile.get(key)
        if isinstance(val, list) and val:
            joined = "; ".join(str(v) for v in val[:10])
            lines.append(f"{label}: {joined}")

    return _NL.join(lines)


def source_document(profile: dict | None) -> str:
    """The brand document as uploaded, never the condensed brief.

    Checks that compare wording or figures against the document, and rhythm
    measurements, have to read the original: a brief is shorter and has none of
    the brand's sentences in it.
    """
    if not profile:
        return ""
    return (
        profile.get("document_full")
        or profile.get("document_context")
        or profile.get("doc_context")
        or ""
    )


def build_brand_rules(profile: dict | None) -> str:
    """Rules every drafting call has to respect, as one block.

    The writer, the platform adapter and the tell-revision pass each used to see
    a different slice of the brand: banned phrases reached only the later
    stages, and the revision pass saw none of it. A rule that depends on a later
    stage cleaning up after an earlier one is not enforced.
    """
    if not profile:
        return ""
    from services.brand_tone import describe

    parts: list[str] = []
    banned = [p.strip() for p in (profile.get("banned_phrases") or []) if isinstance(p, str) and p.strip()]
    if banned:
        parts.append("BANNED PHRASES (never use them; say it plainly): " + ", ".join(banned[:30]))
    preferred = [t.strip() for t in (profile.get("preferred_terms") or []) if isinstance(t, str) and t.strip()]
    if preferred:
        parts.append("PREFERRED TERMS (use these exact words where relevant): " + ", ".join(preferred[:30]))
    compliance = (profile.get("compliance_notes") or "").strip()
    if compliance:
        parts.append("COMPLIANCE (binding):\n" + compliance[:2000])
    tone = describe(profile.get("tone_settings") or profile.get("tone"))
    if tone:
        parts.append(tone)
    if not parts:
        return ""
    return "BRAND RULES\n" + (_NL + _NL).join(parts)


def build_verified_material(profile: dict | None) -> str:
    """Profile facts plus the uploaded brand document, for the grounding check."""
    if not profile:
        return ""
    parts: list[str] = []
    facts = build_verified_facts(profile)
    if facts:
        parts.append(facts)
    doc = (profile.get("document_context") or profile.get("doc_context") or "").strip()
    if doc:
        parts.append("UPLOADED BRAND DOCUMENT:" + _NL + doc[:DOCUMENT_CHARS])
    return (_NL + _NL).join(parts)
