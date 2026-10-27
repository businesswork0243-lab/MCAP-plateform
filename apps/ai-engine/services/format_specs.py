"""What each publishing format is, and whether a piece of text actually is one.

The platform optimizer used to be told "adapt this to LinkedIn" with a handful
of one-line rules, and nothing afterwards ever checked the result. So a 280
character limit was a suggestion, an Instagram caption carried fourteen
hashtags, and every short format came out as the same four sentences lifted
from the article. Two things live here now:

  * the craft brief for each format, which is what the writer is given, and
  * `check()`, a deterministic read of the finished text against that format,
    which is what the optimizer retries on and QA reports.

No model is called from this module.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’-]*")
_HASHTAG = re.compile(r"(?<![\w&])#[A-Za-z][\w]*")
_DIRECTION = re.compile(r"\[[^\]\n]{0,120}\]")
_SENTENCE = re.compile(r"(?<=[.!?\u0964])\s+")

# Text a model leaves behind when it talks to the user instead of writing.
_META_OPENERS = re.compile(
    r"(?is)^\s*(?:here(?:'s| is| are)\b|sure[,!]|certainly[,!]|of course[,!]|"
    r"below is\b|i(?:'ve| have) (?:rewritten|adapted|written)\b)"
)
_PLACEHOLDER = re.compile(
    r"(?i)\[[^\]\n]*(?:placeholder|insert|add (?:a |your |real )?[^\]\n]{0,30}here|"
    r"tbd|todo|your name|lorem)[^\]\n]*\]"
)


@dataclass(frozen=True)
class Spec:
    key: str
    name: str
    length_label: str
    brief: str
    rules: tuple[str, ...]
    min_words: int | None = None
    max_words: int | None = None
    max_chars: int | None = None
    hashtags: tuple[int, int] | None = None     # (min, max) allowed
    units: tuple[int, int] | None = None        # tweets in a thread
    unit_max_chars: int | None = None
    # Share of this piece's sentences allowed to be lifted word for word from
    # the article it was adapted from. None for long forms, which are derived
    # from the article by design.
    max_verbatim: float | None = None
    allow_placeholders: bool = False
    max_tokens: int = 2000
    # Section labels the format cannot do without (matched without case).
    markers: tuple[str, ...] = ()


_SPECS: dict[str, Spec] = {}


def _add(spec: Spec) -> None:
    _SPECS[spec.key] = spec


_add(Spec(
    "linkedin_post", "LinkedIn Post", "150-300 words",
    brief=(
        "Write it as a post a practitioner would publish, from one idea in the brief. "
        "The first line has to stand alone before the 'see more' fold: a specific claim, "
        "number or tension, never a greeting or a definition. Develop that one idea with "
        "one concrete mechanism or example from the draft. Close with a single question "
        "the reader can answer from their own work, or the CTA."
    ),
    rules=(
        "Paragraphs of one to three sentences, a blank line between them",
        "Vary sentence length; do not make every paragraph one short line",
        "3-5 hashtags on the last line only",
        "No bullet-point lists",
    ),
    min_words=150, max_words=300, hashtags=(3, 5), max_verbatim=0.35,
))
_add(Spec(
    "linkedin_article", "LinkedIn Article", "800-1200 words",
    brief=(
        "A reasoned article with a headline that promises a specific outcome. Each section "
        "opens with its conclusion and then supports it. Use the strongest evidence and the "
        "best example from the draft; cut the rest rather than thin everything out."
    ),
    rules=(
        "H2 subheadings that state a claim, not a topic label",
        "End with 3-5 takeaways, one line each, then the CTA",
        "Add an author bio only if the verified facts contain one; otherwise leave it out",
    ),
    min_words=800, max_words=1200, max_tokens=4000,
))
_add(Spec(
    "x_post", "X Post", "up to 280 characters",
    brief=(
        "The sharpest single statement of the thesis, in a form a smart person would quote "
        "or disagree with. One idea, no setup, no thread framing."
    ),
    rules=(
        "Hard limit 280 characters including spaces",
        "At most one hashtag",
    ),
    max_chars=280, hashtags=(0, 1), max_verbatim=0.3, max_tokens=600,
))
_THREAD_RULES = (
    "Number tweets as 1/N, 2/N and so on",
    "Put a line containing only --- between tweets",
    "Every tweet is 280 characters or fewer",
    "No tweet ends on a cliffhanger; each one delivers something by itself",
)
_THREAD_BRIEF = (
    "Tweet 1 has to work as a post on its own and give a reason to read on. Each later "
    "tweet carries one complete thought with its own detail (a mechanism, a number or a "
    "named example from the draft), not a sentence cut from the middle of a paragraph. "
    "The last tweet states the takeaway and the CTA."
)
_add(Spec(
    "x_thread", "X Thread", "8-12 tweets",
    brief=_THREAD_BRIEF, rules=_THREAD_RULES,
    units=(7, 13), unit_max_chars=280, max_verbatim=0.3, max_tokens=3000,
))
_add(Spec(
    "twitter_thread", "Twitter/X Thread", "8-12 tweets",
    brief=_THREAD_BRIEF, rules=_THREAD_RULES,
    units=(7, 13), unit_max_chars=280, max_verbatim=0.3, max_tokens=3000,
))
_add(Spec(
    "blog_post", "Blog Post", "follows the requested word count",
    brief=(
        "A blog post a reader finds by searching and finishes. The first 100 words name the "
        "problem and what the reader will take away. Headings state claims. Include at least "
        "one concrete example from the draft."
    ),
    rules=(
        "H1 headline (use the primary keyword if one is given)",
        "H2 every two or three paragraphs",
        "Numbered list or bullets only where the content is a sequence",
        "Close with a short conclusion and the CTA, then 'META DESCRIPTION:' on its own line (155 characters or fewer)",
    ),
    min_words=500, max_tokens=4000, markers=("META DESCRIPTION",),
))
_add(Spec(
    "newsletter", "Newsletter", "400-700 words",
    brief=(
        "A letter to one reader, not a broadcast. Open on the situation in a sentence or two, "
        "carry one main idea, and end on one next step. Keep the voice personal but do not "
        "invent anecdotes, only use what the draft contains."
    ),
    rules=(
        "First line: 'SUBJECT: ' followed by a real subject line of 60 characters or fewer",
        "Short paragraphs that read well on a phone",
        "Sign off with the author or brand name",
    ),
    min_words=400, max_words=700, max_verbatim=0.5, max_tokens=2500, markers=("SUBJECT:",),
))
_add(Spec(
    "instagram_caption", "Instagram Caption", "125-150 words plus hashtags",
    brief=(
        "Line one is the hook and must work before 'more'. Then short lines, one idea, one "
        "feeling. It should sound like a person talking to their followers, not like an "
        "article shortened. End with a question."
    ),
    rules=(
        "Hook of 125 characters or fewer on the first line",
        "2-3 emojis at most, only where they add something",
        "5-10 hashtags in one block at the end",
    ),
    min_words=100, max_words=190, hashtags=(5, 10), max_verbatim=0.3, max_tokens=1200,
))
_add(Spec(
    "youtube_script", "YouTube Script", "800-1200 words, about 5-8 minutes",
    brief=(
        "Write it to be spoken aloud: short clauses, direct address, a spoken transition at the "
        "start of every section. The hook states the payoff in the first 30 seconds."
    ),
    rules=(
        "Bold section headers with timestamps, for example **HOOK (0:00–0:30)**",
        "[VISUAL CUE: ...] where a graphic or cut belongs, [PAUSE] for emphasis",
        "CTA about 30 seconds before the end, then a short outro",
    ),
    min_words=700, max_words=1300, max_tokens=4000, markers=("HOOK", "VISUAL CUE"),
))
_add(Spec(
    "podcast_notes", "Podcast Show Notes", "400-600 words",
    brief=(
        "Notes a host can talk from. Talking points are things to say, each with the detail "
        "that makes it worth saying, not topic labels."
    ),
    rules=(
        "Episode title suggestion on the first line",
        "2-3 sentence summary for podcast apps",
        "TALKING POINTS: 5-8 bullets, each with 1-2 sub-bullets",
        "KEY QUOTES: 2-3 one-liners",
        "RESOURCES MENTIONED may be a single placeholder line",
        "Listener CTA at the end",
    ),
    min_words=350, max_words=700, allow_placeholders=True, max_tokens=2500,
    markers=("TALKING POINTS", "KEY QUOTES"),
))
_add(Spec(
    "landing_page", "Landing Page Copy", "300-600 words",
    brief=(
        "Copy that sells one outcome to one reader. Every benefit is an outcome the reader gets, "
        "backed by one sentence of proof taken from the draft. Never invent customers, numbers "
        "or guarantees."
    ),
    rules=(
        "Label each part on its own line: HEADLINE: (twelve words or fewer), SUBHEADLINE: (one or two sentences), BENEFITS: (three blocks, each a bold outcome plus a sentence or two of proof), TESTIMONIAL: (a single bracketed slot, for example [Add a real customer quote here]), CTA BUTTON: (the button text)",
        "It is page copy, not an article: short blocks, no long paragraphs",
    ),
    min_words=250, max_words=650, max_verbatim=0.4, allow_placeholders=True, max_tokens=2500,
    markers=("HEADLINE", "BENEFITS", "CTA"),
))
_add(Spec(
    "executive_brief", "Executive Brief", "300-500 words",
    brief=(
        "For a reader with two minutes. The first lines give the conclusion and what to do "
        "about it; everything below supports a decision."
    ),
    rules=(
        "TL;DR of at most three sentences, containing the recommendation",
        "KEY FINDINGS: 3-5 bullets, each a finding and its consequence",
        "BUSINESS IMPACT: risk and opportunity",
        "ACTION ITEMS at the end, owned by roles, not names",
    ),
    min_words=250, max_words=550, max_verbatim=0.4, max_tokens=2000,
    markers=("TL;DR", "KEY FINDINGS", "ACTION ITEMS"),
))
_add(Spec(
    "whatsapp_status", "WhatsApp Status", "50-80 words",
    brief=(
        "A message from a person, not an excerpt. One idea, said plainly, in a single short "
        "paragraph."
    ),
    rules=(
        "50-80 words",
        "No hashtags, headings or lists",
    ),
    min_words=45, max_words=95, hashtags=(0, 0), max_verbatim=0.3, max_tokens=500,
))


def normalize_key(platform: str | None) -> str:
    return (platform or "linkedin_post").lower().replace(" ", "_").replace("-", "_")


def get_spec(platform: str | None) -> Spec:
    return _SPECS.get(normalize_key(platform), _SPECS["linkedin_post"])


def known_platforms() -> list[str]:
    return list(_SPECS)


# ─── Measurement ──────────────────────────────────────────────────────────────

def _prose(text: str) -> str:
    """The text a reader reads: no hashtag lines, no stage directions."""
    text = _DIRECTION.sub(" ", text)
    lines = [
        ln for ln in text.splitlines()
        if not re.fullmatch(r"\s*(?:#[A-Za-z]\w*\s*)+", ln)
    ]
    return "\n".join(lines)


def _words(text: str) -> list[str]:
    """Whitespace-separated words, so Devanagari, Arabic and CJK-spaced text count.

    A letters-only pattern read a 150-word Hindi post as one word and then
    reported it as far too short for LinkedIn.
    """
    return [t for t in text.split() if re.search(r"\w", t)]


def word_count(text: str) -> int:
    return len(_words(_prose(text)))


def _norm(sentence: str) -> str:
    return re.sub(r"[^\w ]+", "", sentence.lower()).strip()


def verbatim_share(text: str, source: str) -> tuple[float, int]:
    """Share of this text's sentences that appear word for word in `source`."""
    src = {_norm(s) for s in _SENTENCE.split(source) if len(_words(s)) >= 6}
    mine = [s for s in _SENTENCE.split(_prose(text)) if len(_words(s)) >= 6]
    if not mine or not src:
        return 0.0, 0
    copied = sum(1 for s in mine if _norm(s) in src)
    return copied / len(mine), copied


def _tweets(text: str) -> list[str]:
    parts = re.split(r"(?m)^\s*-{3,}\s*$", text)
    return [p.strip() for p in parts if p.strip()]


def check(platform: str | None, text: str, source: str | None = None) -> list[str]:
    """Concrete, fixable ways `text` fails to be this format. Empty means it is one.

    Wording is written to be pasted into a repair prompt as-is.
    """
    spec = get_spec(platform)
    issues: list[str] = []
    body = (text or "").strip()
    if not body:
        return ["the output is empty"]

    if _META_OPENERS.match(body):
        issues.append("it opens with a note to the user ('Here is...'); start with the content itself")
    if body.startswith("```") or body.endswith("```"):
        issues.append("it is wrapped in a code fence; remove the fence")

    if not spec.allow_placeholders and _PLACEHOLDER.search(body):
        issues.append("it contains a bracketed placeholder; write the real text or cut the line")

    words = word_count(body)
    if spec.min_words and words < int(spec.min_words * 0.85):
        issues.append(f"it is {words} words; the format needs {spec.min_words}-{spec.max_words or 'more'}")
    if spec.max_words and words > int(spec.max_words * 1.2):
        issues.append(f"it is {words} words; the limit is {spec.max_words}")

    lowered = body.lower()
    missing = [m for m in spec.markers if m.lower() not in lowered]
    if missing:
        issues.append("it is missing the part(s) this format needs: " + ", ".join(missing))

    if spec.max_chars and len(body) > spec.max_chars:
        issues.append(f"it is {len(body)} characters; the limit is {spec.max_chars}")

    if spec.hashtags is not None:
        low, high = spec.hashtags
        n = len(set(h.lower() for h in _HASHTAG.findall(body)))
        if n > high:
            issues.append(f"it has {n} hashtags; the most allowed is {high}")
        elif n < low:
            issues.append(f"it has {n} hashtags; it needs at least {low}")

    if spec.units:
        tweets = _tweets(body)
        low, high = spec.units
        if not (low <= len(tweets) <= high):
            issues.append(f"it has {len(tweets)} tweets; a thread needs {low}-{high}, separated by lines of ---")
        if spec.unit_max_chars:
            long_ones = [i + 1 for i, t in enumerate(tweets) if len(t) > spec.unit_max_chars]
            if long_ones:
                shown = ", ".join(str(i) for i in long_ones[:5])
                issues.append(f"tweet(s) {shown} exceed {spec.unit_max_chars} characters")

    if source and spec.max_verbatim is not None:
        share, copied = verbatim_share(body, source)
        if copied >= 3 and share > spec.max_verbatim:
            issues.append(
                f"{copied} of its sentences are copied word for word from the article; "
                "write this format's own sentences from the same ideas"
            )

    return issues


def rank(platform: str | None, text: str, source: str | None = None) -> tuple[int, int]:
    """How far `text` is from being the format: (problems, overflow). Lower is better.

    Counting problems alone cannot tell "three tweets over the limit" from "one
    tweet over the limit", and a repair that fixed two of three looked like no
    progress. Overflow is the amount by which the hard limits are exceeded.
    """
    spec = get_spec(platform)
    body = (text or "").strip()
    overflow = 0
    if spec.max_chars:
        overflow += max(0, len(body) - spec.max_chars)
    if spec.units and spec.unit_max_chars:
        overflow += sum(max(0, len(t) - spec.unit_max_chars) for t in _tweets(body))
    words = word_count(body)
    if spec.max_words:
        overflow += max(0, words - spec.max_words)
    if spec.min_words:
        overflow += max(0, spec.min_words - words)
    return len(check(platform, body, source)), overflow


def _shorten(text: str, limit: int) -> str:
    """Cut `text` to `limit` characters by dropping whole sentences from the end."""
    if len(text) <= limit:
        return text
    sentences = _SENTENCE.split(text.strip())
    while len(sentences) > 1 and len(" ".join(sentences)) > limit:
        sentences.pop()
    out = " ".join(sentences)
    if len(out) > limit:
        # One sentence on its own is too long: cut at a word boundary.
        out = out[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:- ") + "…"
    return out


def enforce_hard_limits(platform: str | None, text: str) -> str:
    """Guarantee the character limits, which a model cannot count reliably.

    Repair prompts get most over-long tweets under the limit and then a later
    editing pass adds a few words back. A character limit is a fact about the
    channel, so the last step in the pipeline settles it in code. Only a piece
    that is actually over is touched, and only by dropping its last sentence(s).
    """
    spec = get_spec(platform)
    body = text or ""
    if spec.max_chars and len(body.strip()) > spec.max_chars:
        return _shorten(body.strip(), spec.max_chars)
    if spec.units and spec.unit_max_chars:
        parts = re.split(r"(?m)(^[ 	]*-{3,}[ 	]*$)", body)
        out = []
        for part in parts:
            if re.fullmatch(r"[ 	]*-{3,}[ 	]*", part) or not part.strip():
                out.append(part)
                continue
            lead = part[: len(part) - len(part.lstrip())]
            trail = part[len(part.rstrip()):]
            out.append(lead + _shorten(part.strip(), spec.unit_max_chars) + trail)
        return "".join(out)
    return body


def describe_rules(spec: Spec) -> str:
    return "\n".join(f"  - {r}" for r in spec.rules)
