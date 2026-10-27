"""The agents' output is held to the format it was written for, and the checks
that judge it fail loudly instead of approving what they could not read.

No test here calls a model. `complete` is replaced wherever an agent would.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

import pytest

AI_ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ENGINE))
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")

from services import format_specs  # noqa: E402
from agents import platform_optimizer, qa_agent  # noqa: E402
from agents.rule_engine.agents.static_validator import StaticValidatorAgent  # noqa: E402
from agents.rule_engine.rules.rule_models import Rule, RuleType, RuleCategory, RuleSeverity  # noqa: E402

ARTICLE = (
    "A token sale closes in a week and the team has a year of runway. Nobody on the cap table "
    "is a customer. That is a financing event, and every company has them. The trouble starts "
    "when the financing event becomes the thing the company does. Revenue is recognised when a "
    "customer receives a promised service. Capital is raised from people who expect a return. "
    "Both show up on a bank statement, which is why the two get confused for so long."
)


# ─── format_specs.check ──────────────────────────────────────────────────────

def test_x_post_over_the_character_limit_is_flagged():
    assert any("characters" in i for i in format_specs.check("x_post", "word " * 80))


def test_x_post_within_limit_passes():
    assert format_specs.check("x_post", "Most token projects were funded by buyers, not customers.") == []


def test_instagram_hashtag_flood_is_flagged():
    tags = " ".join(f"#tag{i}" for i in range(14))
    text = ("Line one is the hook for the post. " * 4 + "\n\n" + tags)
    assert any("hashtags" in i for i in format_specs.check("instagram_caption", text * 1))


def test_thread_needs_separators_and_short_tweets():
    long_tweet = "x" * 300
    issues = format_specs.check("x_thread", "\n---\n".join([long_tweet] * 8))
    assert any("exceed 280" in i for i in issues)
    assert any("tweets" in i for i in format_specs.check("x_thread", "one single block of text"))


def test_placeholder_is_flagged_except_where_the_format_has_a_slot():
    text = "Headline\n\n[TESTIMONIAL PLACEHOLDER]\n\n" + "word " * 300
    assert any("placeholder" in i for i in format_specs.check("linkedin_post", text))
    assert not any("placeholder" in i for i in format_specs.check("landing_page", text))


def test_meta_commentary_opener_is_flagged():
    assert any("note to the user" in i for i in format_specs.check("x_post", "Here is your post: Tokens are not revenue."))


def test_copied_sentences_are_flagged_for_short_formats_only():
    copied = ". ".join(ARTICLE.split(". ")[:5]) + "."
    assert any("copied word for word" in i for i in format_specs.check("whatsapp_status", copied, source=ARTICLE))
    assert not any("copied" in i for i in format_specs.check("blog_post", copied, source=ARTICLE))


def test_every_platform_has_a_spec():
    for key in ("linkedin_post", "linkedin_article", "x_post", "x_thread", "twitter_thread",
                "blog_post", "newsletter", "instagram_caption", "youtube_script",
                "podcast_notes", "landing_page", "executive_brief", "whatsapp_status"):
        assert key in format_specs.known_platforms()


# ─── platform optimizer ──────────────────────────────────────────────────────

def _fake_complete(responses):
    calls = []

    async def fake(system, user, temperature=0.7, max_tokens=4096):
        calls.append({"user": user, "max_tokens": max_tokens})
        return responses.pop(0), 100

    return fake, calls


def test_brief_is_extracted_as_json(monkeypatch):
    brief_json = json.dumps({"thesis": "Token sales are financing.", "points": ["a", "b"], "evidence": [], "quotable": []})
    fake, _ = _fake_complete([brief_json])
    monkeypatch.setattr(platform_optimizer, "complete", fake)
    brief, tokens = asyncio.run(platform_optimizer.build_brief(ARTICLE + " " + ARTICLE))
    assert brief["thesis"] == "Token sales are financing." and tokens == 100


def test_unusable_brief_is_not_fatal(monkeypatch):
    fake, _ = _fake_complete(["not json at all"])
    monkeypatch.setattr(platform_optimizer, "complete", fake)
    brief, _ = asyncio.run(platform_optimizer.build_brief(ARTICLE + " " + ARTICLE))
    assert brief is None


def test_a_format_failure_triggers_one_repair_and_is_kept_when_it_helps(monkeypatch):
    too_long = "word " * 90
    fixed = "Tokens are financing, not revenue."
    fake, calls = _fake_complete([too_long, fixed])
    monkeypatch.setattr(platform_optimizer, "complete", fake)
    out = asyncio.run(platform_optimizer.run(ARTICLE, "x_post"))
    assert len(calls) == 2 and "280" in calls[1]["user"]
    assert out["content"] == fixed and out["repaired"] is True and out["formatIssues"] == []


def test_a_clean_first_draft_costs_one_call(monkeypatch):
    fake, calls = _fake_complete(["Buyers are not customers. A sale is financing, and financing is not revenue."])
    monkeypatch.setattr(platform_optimizer, "complete", fake)
    out = asyncio.run(platform_optimizer.run(ARTICLE, "x_post"))
    assert len(calls) == 1 and out["repaired"] is False


def test_the_brief_reaches_the_prompt(monkeypatch):
    fake, calls = _fake_complete(["Short enough post about token sales and customers today."])
    monkeypatch.setattr(platform_optimizer, "complete", fake)
    asyncio.run(platform_optimizer.run(ARTICLE, "x_post", brief={"thesis": "THESIS-MARKER", "points": []}))
    assert "THESIS-MARKER" in calls[0]["user"]


# ─── rule engine validator ───────────────────────────────────────────────────

def _rules(*ids):
    return [Rule(id=i, type=RuleType.STATIC, category=RuleCategory.GRAMMAR, severity=RuleSeverity.HIGH,
                 name=i, description="", instruction="", weight=0.1) for i in ids]


def test_compact_response_lists_only_violations():
    v = StaticValidatorAgent()
    body = json.dumps({"violations": [{"rule_id": "SR006", "violation_description": "bad", "location": "The sentence.", "suggestion": "fix"}]})
    violations, passed = v._parse_response(body, _rules("SR006", "SR007"))
    assert [x.rule_id for x in violations] == ["SR006"] and passed == ["SR007"]


def test_a_violation_without_a_quote_is_not_counted():
    v = StaticValidatorAgent()
    body = json.dumps({"violations": [{"rule_id": "SR006", "violation_description": "feels off", "location": "", "suggestion": "x"}]})
    violations, passed = v._parse_response(body, _rules("SR006"))
    assert violations == [] and passed == ["SR006"]


def test_older_evaluations_shape_still_parses():
    v = StaticValidatorAgent()
    body = json.dumps({"evaluations": [{"rule_id": "SR006", "status": "violated", "location": "q", "suggestion": "s"},
                                       {"rule_id": "SR007", "status": "passed"}]})
    violations, passed = v._parse_response(body, _rules("SR006", "SR007"))
    assert len(violations) == 1 and passed == ["SR007"]


def test_a_cut_off_response_keeps_finished_items_and_marks_the_rest_unverified():
    v = StaticValidatorAgent()
    cut = ('{"violations": [{"rule_id": "SR006", "violation_description": "d", "location": "A quote.", "suggestion": "s"},'
           ' {"rule_id": "SR007", "violation_description": "unfinished sentence that never clo')
    violations, passed = v._parse_response(cut, _rules("SR006", "SR007", "SR008"))
    assert [x.rule_id for x in violations] == ["SR006"]
    assert passed == [] and v._unverified == {"SR007", "SR008"}


def test_garbage_is_unverified_not_clean():
    v = StaticValidatorAgent()
    violations, passed = v._parse_response("I could not do that.", _rules("SR006"))
    assert violations == [] and passed == [] and v._unverified == {"SR006"}


def test_format_problems_are_caught_without_a_model():
    v = StaticValidatorAgent()
    found = v._detect_format_issues("word " * 90, "x_post")
    assert found and found[0].rule_id == "FMT001"
    assert v._detect_format_issues("A short post.", "x_post") == []


def test_model_written_rules_cannot_be_critical():
    rule = _rules("DR1")[0].model_copy(update={"severity": RuleSeverity.CRITICAL})
    assert StaticValidatorAgent._cap_severity(rule).severity == RuleSeverity.HIGH


# ─── QA ──────────────────────────────────────────────────────────────────────

def test_qa_that_cannot_be_parsed_twice_leaves_the_piece_unscored(monkeypatch):
    async def garbage(system, user, temperature=0.2, max_tokens=800):
        return "Sorry, I cannot produce JSON.", 10

    monkeypatch.setattr(qa_agent, "complete", garbage)
    out = asyncio.run(qa_agent.run(ARTICLE, platform="linkedin_post"))
    assert out["passed"] is False and out["overallScore"] == 0
    assert any("qa_unscored" in f for f in out["flags"])


def test_a_short_x_post_is_not_flagged_as_too_short():
    flags = qa_agent._local_analysis("Buyers are not customers, and a sale is not revenue.", [], None, "x_post")
    assert not any("content_too_short" in f for f in flags)
    assert any("content_too_short" in f for f in qa_agent._local_analysis("Too short.", [], None, None))


# ─── second repair, voice target, hard format cap ────────────────────────────

def test_a_second_repair_runs_when_the_first_only_partly_helped(monkeypatch):
    two_over = "\n---\n".join(["short tweet number %d about token sales." % i for i in range(5)]
                              + ["x" * 300, "y" * 300, "short tweet number 8 about token sales."])
    one_over = "\n---\n".join(["short tweet number %d about token sales." % i for i in range(7)] + ["z" * 300])
    clean = "\n---\n".join(["short tweet number %d about token sales." % i for i in range(8)])
    fake, calls = _fake_complete([two_over, one_over, clean])
    monkeypatch.setattr(platform_optimizer, "complete", fake)
    out = asyncio.run(platform_optimizer.run(ARTICLE, "x_thread"))
    assert len(calls) == 3 and out["formatIssues"] == []


def test_the_voice_target_reaches_the_platform_prompt(monkeypatch):
    fake, calls = _fake_complete(["A short post about token sales and customers, written plainly."])
    monkeypatch.setattr(platform_optimizer, "complete", fake)
    asyncio.run(platform_optimizer.run(ARTICLE, "x_post", voice_target="THIS BRAND'S MEASURED WRITING RHYTHM:\n  - Sentences average 10 words"))
    assert "MEASURED WRITING RHYTHM" in calls[0]["user"]


def test_a_hard_format_violation_fails_the_piece_so_the_rewrite_runs(monkeypatch):
    from agents.rule_engine.agents import static_validator as sv

    async def nothing_wrong(*_a, **_k):
        return json.dumps({"violations": []}), 10

    monkeypatch.setattr(sv, "complete", nothing_wrong)
    v = sv.StaticValidatorAgent()
    over = ("Buyers are not customers and a sale is financing. " * 12).strip()
    result = asyncio.run(v.validate(over, platform="x_post"))
    assert result.score <= sv.FORMAT_FAIL_CAP and result.passed is False
    fine = asyncio.run(v.validate("Buyers fund projects. Customers fund businesses.", platform="x_post"))
    assert fine.score > sv.FORMAT_FAIL_CAP


def test_a_format_missing_its_required_parts_is_flagged():
    body = "word " * 320
    assert any("missing" in i and "ACTION ITEMS" in i for i in format_specs.check("executive_brief", body))
    assert not any("missing" in i for i in format_specs.check("executive_brief", "TL;DR x\nKEY FINDINGS y\nACTION ITEMS z\n" + body))
    assert any("SUBJECT" in i for i in format_specs.check("newsletter", "word " * 500))


def test_hard_limits_are_enforced_in_code():
    long_post = "First idea stands alone. " + "A second sentence that carries on for a while. " * 12
    cut = format_specs.enforce_hard_limits("x_post", long_post)
    assert len(cut) <= 280 and cut.startswith("First idea stands alone.")

    thread = "1/3\n\nShort one here.\n\n---\n\n2/3\n\n" + "A long tweet sentence goes on. " * 15 + "\n\n---\n\n3/3\n\nLast one."
    fixed = format_specs.enforce_hard_limits("x_thread", thread)
    assert all(len(t) <= 280 for t in format_specs._tweets(fixed))
    assert "Short one here." in fixed and "Last one." in fixed and fixed.count("---") == 2


def test_enforcement_leaves_compliant_text_alone():
    ok = "Buyers are not customers, and a sale is financing."
    assert format_specs.enforce_hard_limits("x_post", ok) == ok
    assert format_specs.enforce_hard_limits("linkedin_post", "word " * 400) == "word " * 400


def test_hindi_text_is_counted_by_words_not_ignored():
    hindi = " ".join(["\u091f\u094b\u0915\u0928 \u0938\u0947\u0932 \u090f\u0915 \u0918\u091f\u0928\u093e \u0939\u0948\u0964"] * 40)
    assert format_specs.word_count(hindi) >= 150
    assert not any("words" in i and "needs" in i for i in format_specs.check("linkedin_post", hindi + " #web3 #tokens #business"))


def test_the_writer_is_told_not_to_invent_evidence_about_the_world():
    from agents import canonical_writer
    assert "EVIDENCE" in canonical_writer.SYSTEM and "hypothetical" in canonical_writer.SYSTEM


def test_an_unsourced_statistic_flag_fails_qa_whatever_it_is_called():
    flags = ["Unsourced statistic: 'falls eighty percent' reads as a specific figure"]
    assert qa_agent._count_critical_flags(flags) == 1
