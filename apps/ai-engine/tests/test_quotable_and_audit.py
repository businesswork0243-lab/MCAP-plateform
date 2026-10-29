"""Quotable lines, late address and the rule-enforcement audit.

A reviewer circled "That's a different dream wearing the same vocabulary." in a
generated post and said it reads as machine-written and does not speak to the
reader. These pin that the line is now found, that a plain version of the same
idea is not, and that every rule in the engine has a fixture proving it fires.
"""
import os
import sys
from pathlib import Path

AI_ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ENGINE))
sys.path.insert(0, str(AI_ENGINE / "eval" / "audit"))
sys.path.insert(0, str(AI_ENGINE / "scripts"))
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")


def ids_in(text):
    from services.tells import tell_report
    return set(tell_report(text)["effective_ids"])


def test_the_circled_line_is_found():
    text = 'Years of hype later, the loudest conversation is "enterprise adoption of blockchain." That\'s a different dream wearing the same vocabulary.'
    assert "TELL38" in ids_in(text)


def test_a_sentence_ending_inside_a_quote_still_ends_the_sentence():
    from services.tells import _prose_sentences

    sentences = [s[2] for s in _prose_sentences('He called it "a pivot." Then he left the room.')]
    assert sentences == ['He called it "a pivot."', "Then he left the room."]


def test_the_plain_version_of_the_idea_is_not_flagged():
    plain = (
        "Enterprise blockchains keep the vocabulary of Web3 and drop its promise. "
        "On a permissioned chain the operator can reverse a transaction, so users still depend on someone's permission."
    )
    assert not ids_in(plain) & {"TELL38", "TELL39", "TELL40"}


def test_ordinary_clothing_is_not_a_metaphor():
    assert "TELL38" not in ids_in("She was wearing a red coat when the auditors arrived on Monday morning.")


def test_one_closing_line_is_a_choice_and_a_habit_is_a_tell():
    from fixtures import TELL_FIXTURES

    one = (
        "Matching ran for three days every month and nobody questioned why it took that long.\n\n"
        "We traced it to two systems that export different formats, which forced a retype of every bank line each time.\n\n"
        "Once the export was fixed the match took an afternoon and the close fell from six days to four.\n\n"
        "The saving is real, and it came from one dull change to a file format that nobody had looked at in years."
    )
    assert "TELL40" not in ids_in(one)
    assert "TELL40" in ids_in(TELL_FIXTURES["TELL40"])


def test_an_opening_that_speaks_to_the_reader_passes_and_one_that_does_not_is_found():
    from fixtures import CLEAN, TELL_FIXTURES

    assert "TELL41" not in ids_in(CLEAN)
    assert "TELL41" in ids_in(TELL_FIXTURES["TELL41"])
    short = "Permissioned chains change who controls the ledger.\n\nThat is the whole point of them."
    assert "TELL41" not in ids_in(short), "a short piece has no room to owe the reader an opening"


def test_an_imperative_counts_as_speaking_to_the_reader():
    from fixtures import TELL_FIXTURES

    text = TELL_FIXTURES["TELL41"].replace(
        "Permissioned chains change", "Look at how permissioned chains change", 1)
    assert "TELL41" not in ids_in(text)


def test_pointer_words_inside_a_sentence_keep_it_connected():
    from fixtures import CLEAN

    assert "TELL37" not in ids_in(CLEAN)


def test_the_new_rules_have_ids_fixes_and_a_severity_that_earns_a_rewrite():
    from agents.rule_engine.orchestrator import POLISH_SEVERITIES
    from agents.rule_engine.rules.tell_rules import FIXES, TELL_RULE_IDS, TELL_RULES

    by_id = {r.id: r for r in TELL_RULES}
    for pid, rid in (("TELL38", "SR052"), ("TELL39", "SR053"), ("TELL40", "SR054"), ("TELL41", "SR055")):
        assert TELL_RULE_IDS[pid] == rid and FIXES[pid]
        assert by_id[rid].severity in POLISH_SEVERITIES


def test_the_writer_is_told_before_it_drafts():
    from agents.canonical_writer import SYSTEM

    assert "Talk to the reader" in SYSTEM and "No quotable lines" in SYSTEM


# ── The audit itself ──────────────────────────────────────────────────────────

def test_every_code_rule_fires_on_its_fixture_and_stays_quiet_on_clean_text():
    import rule_audit

    agent = rule_audit.StaticValidatorAgent()
    rows = rule_audit.audit_deterministic(agent)
    assert len(rows) >= 38
    _, problems = rule_audit.summarise(rows)
    assert problems == [], problems


def test_every_llm_judged_rule_has_a_fixture_for_the_live_audit():
    from agents.rule_engine.rules.static_rules import get_static_rules
    from fixtures import LLM_FIXTURES

    llm_rules = {r.id for r in get_static_rules() if not r.deterministic}
    assert llm_rules == set(LLM_FIXTURES), llm_rules ^ set(LLM_FIXTURES)


def test_consequence_tiers_are_what_the_report_claims():
    import rule_audit

    agent = rule_audit.StaticValidatorAgent()
    by_id = {r.id: r for r in agent.static_rules}
    assert rule_audit.consequence(agent, by_id["SR014"]) == rule_audit.BLOCKS
    assert rule_audit.consequence(agent, by_id["SR052"]) == rule_audit.REWRITES
    assert rule_audit.consequence(agent, by_id["SR023"]) == rule_audit.REPORT_ONLY
