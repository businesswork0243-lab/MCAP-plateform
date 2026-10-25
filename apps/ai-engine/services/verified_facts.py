"""What the brand has actually told us about itself.

Grounding rules (SR014-SR016) ask whether a first-person claim is supported.
That question has no answer unless the checker can see the support, and the
rule engine used to receive only the draft. Every "we" sentence was therefore
read as invented, drafts were sent back for rewrites they did not need, and the
writer learned that the safe move was to avoid first person altogether.
"""
from __future__ import annotations

_NL = chr(10)

# The uploaded document is the richest source and also the longest. The cap
# keeps a validator batch affordable; the writer sees the same document at
# 12000, which is fine because it is composing and this is only checking.
DOCUMENT_CHARS = 6000


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
