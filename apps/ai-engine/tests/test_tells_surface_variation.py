"""The contrast move survives a surface edit; the detectors have to as well.

A generated LinkedIn post scored 0 effective tells and 0 false negatives while
opening on "Washington's tokenization push isn't about technology. It's about
debt." Three separate causes, each tested here:

  1. Every negation-contrast rule in `text_cleaner` was anchored to a pronoun
     subject and a comma join, so a real noun phrase and a full stop walked
     through all fifteen of them.
  2. Every structural finder in `tells` reads one paragraph at a time. A social
     post puts one sentence per block, so the evidence never accumulated in a
     window any detector could see.
  3. Shapes that only occur in social copy — the engagement-bait sign-off, the
     listicle promise, the contrast run with the "but" deleted — had no rule.

The negative cases matter as much as the positive ones. Loosening a regex that
gates generation is how a detector starts firing on ordinary writing, and
`eval/corpus/human` is empty, so nothing else in the repository would catch it.
"""
import sys
from pathlib import Path

AI_ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ENGINE))

from services.tells import tell_report  # noqa: E402
from services.text_cleaner import detect_false_negatives  # noqa: E402


def _fn_names(text: str) -> list[str]:
    return [h["pattern"] for h in detect_false_negatives(text)]


def _tell_ids(text: str) -> set[str]:
    return {t["id"] for t in tell_report(text)["effective"]}


# ─── 1. Negation contrast, any subject and any join ───────────────────────────

def test_noun_phrase_subject_and_full_stop_join():
    """The exact sentence that scored clean."""
    text = "Washington's tokenization push isn't about technology. It's about debt."
    assert _fn_names(text), "noun-phrase subject with a full-stop join went undetected"


def test_contrast_variants_all_caught():
    for text in (
        "This isn't just about technology, it's about debt.",       # the old shape
        "The problem is not about cost. It is about trust.",        # uncontracted
        "Our roadmap isn't about features; it is really about reliability.",
        "These aren't about speed, they're about margin.",
    ):
        assert _fn_names(text), f"missed: {text!r}"


def test_plain_negation_is_not_a_contrast():
    """A negation with no affirmative swap after it is ordinary writing."""
    for text in (
        "The migration isn't about to finish.",
        "This release is not about to ship before Friday.",
        "We are not about to rewrite the parser.",
    ):
        assert not _fn_names(text), f"false positive: {text!r}"


def test_two_unrelated_sentences_about_things():
    """Adjacent sentences that merely both use 'about' are not the move."""
    text = (
        "The complaint wasn't about latency. We fixed latency in March, and "
        "the ticket was closed."
    )
    assert not _fn_names(text)


# ─── 2. Structure read across paragraphs, not inside one ──────────────────────

FRAGMENT_POST = (
    "Rates moved again.\n\n"
    "Nobody noticed.\n\n"
    "The desk repriced.\n\n"
    "Twice.\n\n"
    "That was Tuesday.\n\n"
    "By Thursday the book had turned over completely and the risk team asked "
    "for a fresh set of limits, which took another week to agree.\n"
)


def test_fragment_rhythm_seen_across_paragraphs():
    """Short blocks are the tell; splitting them up is what used to hide them."""
    assert "TELL25" in _tell_ids(FRAGMENT_POST)


def test_ordinary_prose_with_one_short_aside_is_clean():
    text = (
        "The settlement cycle shortened to T+1 in May, which pulled a day of "
        "float out of every equity trade and forced the custodians to rebuild "
        "their affirmation flows.\n\n"
        "That part went badly.\n\n"
        "Most desks absorbed it by moving staff onto an earlier shift, and the "
        "fail rate returned to its prior level within about six weeks of the "
        "change taking effect across the street.\n"
    )
    assert "TELL25" not in _tell_ids(text)


def test_hashtag_block_is_not_a_fragment_paragraph():
    """Furniture, not cadence — and platform_optimizer asks for it."""
    body = (
        "The settlement cycle shortened to T+1 in May, which pulled a day of "
        "float out of every equity trade and forced custodians to rebuild "
        "their affirmation flows over the following quarter.\n\n"
        "Most desks absorbed it by moving staff onto an earlier shift, and the "
        "fail rate returned to its prior level within roughly six weeks.\n\n"
        "The custodians carried the cost, which is the part nobody modelled "
        "when the rule was written.\n\n"
        "#Settlement #Custody\n"
    )
    assert "TELL25" not in _tell_ids(body)


def test_parallel_paragraph_openings():
    text = (
        "Tokenization moves collateral faster.\n\n"
        "Tokenization lowers the cost of a repo leg.\n\n"
        "Tokenization does nothing about counterparty risk.\n\n"
        "The last point is the one that matters to a treasurer, and it is the "
        "one the vendors leave out of the deck.\n"
    )
    assert "TELL26" in _tell_ids(text)


# ─── 3. Shapes that only show up in social copy ───────────────────────────────

def test_engagement_bait_closer():
    text = (
        "The state is the largest beneficiary of tokenized collateral, and the "
        "issuers are the second largest.\n\n"
        "If you're building here, how are you reading this?\n"
    )
    assert "TELL27" in _tell_ids(text)


def test_question_in_the_body_is_not_bait():
    """A question that the piece then answers is doing work."""
    text = (
        "So who actually buys the paper?\n\n"
        "Stablecoin issuers, mostly. They hold tens of billions in T-bills "
        "against redemption, and that demand did not exist five years ago, "
        "which is the whole point of the arrangement.\n\n"
        "The Treasury noticed before the issuers did, and priced accordingly "
        "at the following auction.\n"
    )
    assert "TELL27" not in _tell_ids(text)


def test_listicle_promise():
    for text in (
        "For founders, three things matter:",
        "Here are five lessons from that quarter.",
    ):
        assert "TELL28" in _tell_ids(text), f"missed: {text!r}"


def test_contrast_swap_without_the_contrast_word():
    assert "TELL29" in _tell_ids("That's not a conspiracy. It's arithmetic.")


def test_trailing_appositive_contrast():
    assert "TELL29" in _tell_ids(
        "The state is accelerant and beneficiary, not sole cause."
    )


# ─── The post that started it ─────────────────────────────────────────────────

TOKENIZATION_POST = (AI_ENGINE / "tests" / "fixtures" / "tokenization-post.txt")


def test_the_post_no_longer_scores_clean():
    text = TOKENIZATION_POST.read_text(encoding="utf-8")
    report = tell_report(text)
    assert _fn_names(text), "the opening contrast is still invisible"
    assert report["effective_count"] >= 5, (
        f"only {report['effective_count']} effective tells: "
        f"{sorted(t['id'] for t in report['effective'])}"
    )
    assert {"TELL27", "TELL28", "TELL29"} <= _tell_ids(text)


def test_numeric_range_dash_is_not_a_connector():
    """A range, not a connector. Quoting it told the model to use a comma."""
    text = "Annual deficits run $1\u20132 trillion against a 3\u20134% growth rate."
    assert "TELL08" not in {t["id"] for t in tell_report(text)["tells"]}


def test_word_dash_word_still_counts():
    text = "The desk repriced\u2014twice\u2014before the close, and nobody logged it."
    assert "TELL08" in {t["id"] for t in tell_report(text)["tells"]}
