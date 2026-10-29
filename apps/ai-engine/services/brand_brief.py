"""A condensed brief of a brand document too long to send whole.

Every agent used to receive a different leading slice of the document: the
writer the first third, the brand optimizer and QA about a sixth, the platform
adapter none. A 15-page report is about 37,000 characters, so what came after
the first few pages (and in a typical report that is the sections on risks,
sustainability and outlook) never reached any prompt, and a draft that used it
looked invented.

A brief reads the whole document once and keeps what a writer needs, with every
figure, name and date verbatim. Agents then see the whole document's content at
a fraction of its length. The original stays available for the checks that need
it word for word: figure lookups, the claim audit and voice measurement.

One model call per distinct document, cached.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re

from services.llm import complete

log = logging.getLogger("ai-engine.brand_brief")

# Above this many characters the writer could not see the whole document, so a
# brief earns its cost. Below it the document is sent as it is.
THRESHOLD_CHARS = int(os.getenv("BRAND_BRIEF_THRESHOLD_CHARS", "24000"))
SOURCE_CHARS = int(os.getenv("BRAND_BRIEF_SOURCE_CHARS", "80000"))
MIN_BRIEF_CHARS = 600

BRIEF_PREFIX = "BRAND BRIEF (condensed from the full brand document; every figure, name and date is kept as written)\n"

_CACHE: dict[str, str] = {}
_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")

SYSTEM = """You condense a brand document into a brief that writers will use. Return the brief only.

Keep, verbatim: every figure, percentage, date, year, name, product, place and stated target, with the period and definition the document gives it (for example the fiscal year a metric belongs to). Keep every rule, caution and compliance statement the document makes. Keep the document's own wording for its purpose, promise and key messages.

Drop repetition, tables' scaffolding, navigation text, glossaries and generic advice. Never add a fact, a number, an opinion or a recommendation that is not in the document.

Use these headings, omitting any the document has nothing for:
FACTS AND FIGURES / HISTORY AND TIMELINE / PRODUCTS AND HOW THEY WORK / AUDIENCE / POSITIONING AND PROMISE / KEY MESSAGES / HOW THE DOCUMENT SAYS THE BRAND COMMUNICATES / RULES AND CAUTIONS / TARGETS AND PLANS (label targets as targets, not results)"""


def needs_brief(document: str | None) -> bool:
    return bool(document) and len(document) > THRESHOLD_CHARS


def _numbers(text: str) -> set[str]:
    return {n.replace(",", "").rstrip(".") for n in _NUMBER.findall(text)}


async def build(document: str) -> tuple[str, int]:
    """(brief, tokens). An empty brief means keep using the document as it is."""
    if not needs_brief(document):
        return "", 0

    key = hashlib.sha256(document.encode("utf-8", "ignore")).hexdigest()
    if key in _CACHE:
        return _CACHE[key], 0

    try:
        brief, tokens = await complete(
            SYSTEM,
            "BRAND DOCUMENT:\n" + document[:SOURCE_CHARS],
            temperature=0.1,
            max_tokens=3000,
        )
    except Exception as e:
        log.warning("Brand brief unavailable, using the document as is (non-fatal): %s", e)
        return "", 0

    brief = (brief or "").strip()
    if len(brief) < MIN_BRIEF_CHARS:
        log.warning("Brand brief too short (%d chars), discarded", len(brief))
        return "", tokens

    # A number the document does not contain is a number the brief invented, and
    # every agent would then treat it as verified.
    invented = _numbers(brief) - _numbers(document)
    if invented:
        log.warning("Brand brief discarded: it contains figures absent from the document: %s",
                    sorted(invented)[:8])
        return "", tokens

    _CACHE[key] = brief
    return brief, tokens


async def attach(profile: dict | None) -> tuple[dict | None, int]:
    """The profile with a brief in `document_context` and the original in `document_full`."""
    if not profile:
        return profile, 0
    document = (profile.get("document_context") or profile.get("doc_context") or "").strip()
    if not needs_brief(document):
        return profile, 0

    brief, tokens = await build(document)
    if not brief:
        return profile, tokens

    out = dict(profile)
    out["document_full"] = document
    out["document_context"] = out["doc_context"] = BRIEF_PREFIX + brief
    log.info("Brand brief attached | document=%d chars | brief=%d chars", len(document), len(brief))
    return out, tokens
