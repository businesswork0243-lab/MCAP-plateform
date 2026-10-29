"""Regression tests for the findings of the agent walkthrough report.

A step-by-step run of the pipeline on a real brand document showed that brand
tone never reached the writer, that QA failed a correct draft on a wording nit,
that the rule engine left passing drafts untouched, and several smaller gaps.
Each test here pins one of those fixes. Every LLM call is stubbed.
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

CASUAL = {"formality": 2, "humor": 8, "enthusiasm": 8, "confidence": 8}


def run(coro):
    return asyncio.run(coro)


def recording_stub(captured: list, reply: str = "A clean draft sentence. It reads fine."):
    async def stub(system, user, temperature=0.7, max_tokens=4096, prefer=None):
        captured.append(system + "\n" + user)
        return reply, 10
    return stub


# ── Brand tone ────────────────────────────────────────────────────────────────

def test_tone_describe_gives_instructions_for_off_centre_sliders_only():
    from services.brand_tone import describe

    text = describe(CASUAL)
    assert "Casual" in text and "Contractions" in text
    assert "humor" in text.lower() and "Energetic" in text
    # Middle-of-the-range sliders say nothing: "moderately formal" changes no sentence.
    assert describe({"formality": 5, "humor": 4}) == ""
    assert describe(None) == "" and describe({}) == ""


def test_canonical_writer_receives_brand_tone_and_banned_phrases(monkeypatch):
    from agents import canonical_writer

    seen: list = []
    monkeypatch.setattr(canonical_writer, "complete", recording_stub(seen))
    run(canonical_writer.run(
        topic="Why menus matter", brand_tone=CASUAL, banned_phrases=["game-changing", "disrupt"],
        brand_document_context="CANARY_DOC " + "The brand writes plainly. " * 30,
    ))
    prompt = seen[0]
    assert "BRAND TONE" in prompt and "Casual" in prompt
    assert "BANNED PHRASES" in prompt and "game-changing" in prompt
    # The document used to be sent twice, once as guidelines and once as "facts".
    assert prompt.count("CANARY_DOC") == 1


def test_tell_revision_pass_sees_the_brand_rules(monkeypatch):
    from agents import canonical_writer

    seen: list = []
    monkeypatch.setattr(canonical_writer, "complete", recording_stub(seen))

    class Heavy(dict):
        pass

    import services.tells as tells
    monkeypatch.setattr(tells, "tell_report", lambda t: {"per_100_words": 9.0, "effective_count": 9,
                                                         "effective": [], "tells": []})
    monkeypatch.setattr(tells, "format_for_prompt", lambda t, limit=15: "- a flagged sentence")
    run(canonical_writer._revise_if_tell_heavy("Some draft text here.", 500, "BRAND RULES\nBANNED PHRASES: disrupt"))
    assert any("BANNED PHRASES: disrupt" in p for p in seen), "the revision call must carry the brand rules"


def test_platform_optimizer_receives_brand_rules(monkeypatch):
    from agents import platform_optimizer

    seen: list = []
    monkeypatch.setattr(platform_optimizer, "complete", recording_stub(seen))
    run(platform_optimizer.run(
        canonical_draft="A draft. " * 40, target_platform="linkedin_post",
        brand_rules="BRAND RULES\nBANNED PHRASES (never use them): disrupt",
    ))
    assert "BANNED PHRASES (never use them): disrupt" in seen[0]


def test_build_brand_rules_collects_every_rule():
    from services.verified_facts import build_brand_rules

    text = build_brand_rules({
        "banned_phrases": ["disrupt"], "preferred_terms": ["delivery partners"],
        "compliance_notes": "No investment advice.", "tone_settings": CASUAL,
    })
    for needle in ("disrupt", "delivery partners", "No investment advice.", "BRAND TONE"):
        assert needle in text
    assert build_brand_rules({}) == "" and build_brand_rules(None) == ""


def test_humanizer_receives_compliance_notes(monkeypatch):
    from agents import humanizer

    seen: list = []
    monkeypatch.setattr(humanizer, "complete", recording_stub(seen, "Clean text that reads well."))
    run(humanizer.run(
        content="Clean text that reads well.", brand_data={"compliance_notes": "CANARY_COMPLIANCE no advice"},
        extra_context={"skip_rule_engine": True, "platform": "linkedin_post"},
    ))
    assert "CANARY_COMPLIANCE" in seen[0]


def test_humanizer_reports_no_reduction_when_nothing_was_found(monkeypatch):
    from agents import humanizer

    monkeypatch.setattr(humanizer, "complete", recording_stub([], "Clean text that reads well."))
    out = run(humanizer.run(content="Clean text that reads well.", extra_context={"skip_rule_engine": True}))
    assert out["metadata"]["reduction_percent"] is None


def test_brand_optimizer_prompt_makes_the_tone_binding(monkeypatch):
    from agents import brand_optimizer

    seen: list = []
    monkeypatch.setattr(brand_optimizer, "complete", recording_stub(seen))
    run(brand_optimizer.run("A formal sentence.", {"name": "Acme", "tone_settings": {**CASUAL, "storytelling": 9}}))
    prompt = seen[0]
    assert "binding" in prompt
    assert "Humor:          8/10" in prompt and "Storytelling:   9/10" in prompt
    assert "leave it exactly as it is" not in prompt, "the leave-it-alone rule must not override the tone profile"


# ── QA ────────────────────────────────────────────────────────────────────────

MATERIAL = "Report. FY2025-26 annual-report materials show 979 million orders and 330,000 partners."


def test_metric_flag_for_figures_in_the_material_is_downgraded():
    from agents.qa_agent import _reconcile_metric_flags, _count_critical_flags

    flags = ["fabricated_metric: '979 million orders and 330,000 partners' — the label should read FY2026"]
    out = _reconcile_metric_flags(flags, MATERIAL)
    assert out[0].startswith("metric_wording:")
    assert _count_critical_flags(out) == 0, "a wording nit must not fail the piece"


def test_metric_flag_for_a_missing_figure_stays_critical():
    from agents.qa_agent import _reconcile_metric_flags, _count_critical_flags

    flags = ["fabricated_metric: 'In 2019 Zomato served 3.2 billion orders' — not in the brand document"]
    out = _reconcile_metric_flags(flags, MATERIAL)
    assert out == flags and _count_critical_flags(out) == 1


def test_metric_flag_without_figures_or_material_is_left_alone():
    from agents.qa_agent import _reconcile_metric_flags

    flag = "fabricated_metric: 'a study found it works' — no source"
    assert _reconcile_metric_flags([flag], MATERIAL) == [flag]
    assert _reconcile_metric_flags([flag], "") == [flag]


def _qa_reply(**scores):
    base = {k: 85 for k in ("readabilityScore", "brandScore", "structureScore", "platformScore",
                            "humanizationScore", "consistencyScore", "clarityScore", "engagementScore",
                            "ctaScore", "groundingScore")}
    base.update({"flags": [], "suggestions": [], "summary": "ok", **scores})
    return json.dumps(base)


def test_claim_audit_flags_unsupported_claims_as_warnings_not_failures(monkeypatch):
    from agents import qa_agent

    document = "Brand document. " + "Foodiebay listed restaurant menus in 2008. " * 20

    async def stub(system, user, temperature=0.7, max_tokens=4096, prefer=None):
        if "compare a draft" in system:
            return json.dumps({"unsupported": [{"sentence": "The directory earned its revenue from advertising.",
                                                "reason": "revenue model not in the document"}]}), 50
        return _qa_reply(), 100

    monkeypatch.setattr(qa_agent, "complete", stub)
    draft = ("Menus changed how people choose a place to eat. " * 12
             + "The directory earned its revenue from advertising.")
    result = run(qa_agent.run(draft, {"name": "Acme", "document_context": document}))
    flag = next(f for f in result["flags"] if f.startswith("unverified_claim"))
    assert "advertising" in flag
    assert result["claimAudit"]["unsupported"][0]["reason"].startswith("revenue model")
    assert result["passed"] is True, "an unverified claim is a warning; it must not block the piece"


def test_claim_audit_is_skipped_without_a_document(monkeypatch):
    from agents import qa_agent

    calls: list = []

    async def stub(system, user, temperature=0.7, max_tokens=4096, prefer=None):
        calls.append(system)
        return _qa_reply(), 100

    monkeypatch.setattr(qa_agent, "complete", stub)
    result = run(qa_agent.run("A draft.", {"name": "Acme"}))
    assert result["claimAudit"] is None and len(calls) == 1


# ── Rule engine ───────────────────────────────────────────────────────────────

def test_rule_generator_context_carries_tone_mission_and_compliance():
    from agents.rule_engine.agents.dynamic_rule_gen import DynamicRuleGeneratorAgent

    ctx = DynamicRuleGeneratorAgent()._build_context(
        "topic", {"name": "Acme", "tone_settings": CASUAL, "mission_statement": "Better food",
                  "compliance_notes": "No advice.", "key_messages": ["Ops is product"]}, None)
    brand = ctx["brand"]
    assert brand["tone"] == CASUAL, "tone_settings was read from the wrong key and arrived empty"
    assert brand["mission"] == "Better food" and brand["compliance_notes"] == "No advice."


def test_discussion_ctas_are_recognised():
    from agents.rule_engine.orchestrator import cta_invites_discussion

    assert cta_invites_discussion("invite_discussion") and cta_invites_discussion("Comment")
    assert not cta_invites_discussion("newsletter") and not cta_invites_discussion(None)


def test_requested_closing_question_is_not_flagged_as_bait():
    from agents.rule_engine.agents.static_validator import StaticValidatorAgent

    text = ("Menus are catalogues. Delivery is a promise that depends on people. "
            "Which adjacent problem is your product earning the right to solve?")
    agent = StaticValidatorAgent()
    agent._cta_requested = False
    flagged = [v.rule_id for v in agent._detect_tells(text)[0]]
    agent._cta_requested = True
    kept = [v.rule_id for v in agent._detect_tells(text)[0]]
    assert "SR041" in flagged and "SR041" not in kept


class _FakeResult:
    def __init__(self, score, passed, violations=()):
        from agents.rule_engine.rules.rule_models import ValidationResult
        self.value = ValidationResult(score=score, static_score=score, dynamic_score=score, passed=passed,
                                      violations=list(violations), passed_rules=[], critical_failures=[],
                                      iteration=1, feedback="")


def _violation(severity):
    from agents.rule_engine.rules.rule_models import RuleViolation, RuleCategory
    return RuleViolation(rule_id="SR043", rule_name="Contrast swap", severity=severity,
                         category=RuleCategory.AI_PATTERNS, description="d", suggestion="s")


def _orchestrator(monkeypatch, results, regen_log):
    from agents.rule_engine import orchestrator as orch_mod
    from agents.rule_engine.rules.rule_models import DynamicRuleSet

    orch = orch_mod.RuleEngineOrchestrator()

    async def gen(**_):
        return DynamicRuleSet(brand_id="b", request_id="r", generated_at="now", rules=[], context_used={})

    queue = list(results)

    async def validate(**_):
        return queue.pop(0).value

    async def regenerate(**kw):
        regen_log.append(kw["content"])
        return kw["content"] + " (polished)"

    monkeypatch.setattr(orch.rule_gen, "generate", gen)
    monkeypatch.setattr(orch.validator, "validate", validate)
    monkeypatch.setattr(orch.regenerator, "regenerate", regenerate)
    return orch


def test_passing_draft_with_medium_findings_gets_one_polish_pass(monkeypatch):
    from agents.rule_engine.rules.rule_models import RuleSeverity

    regen: list = []
    orch = _orchestrator(monkeypatch, [
        _FakeResult(94.0, True, [_violation(RuleSeverity.MEDIUM)]),
        _FakeResult(98.0, True, []),
    ], regen)
    result = run(orch.process(content="Draft."))
    assert len(regen) == 1, "a passing draft with a medium finding should be polished once"
    assert result.final_content == "Draft. (polished)" and result.total_iterations == 2


def test_polish_is_skipped_for_low_severity_findings(monkeypatch):
    from agents.rule_engine.rules.rule_models import RuleSeverity

    regen: list = []
    orch = _orchestrator(monkeypatch, [_FakeResult(97.0, True, [_violation(RuleSeverity.LOW)])], regen)
    result = run(orch.process(content="Draft."))
    assert not regen and result.final_content == "Draft."


def test_a_worse_polish_is_not_returned(monkeypatch):
    from agents.rule_engine.rules.rule_models import RuleSeverity

    regen: list = []
    orch = _orchestrator(monkeypatch, [
        _FakeResult(94.0, True, [_violation(RuleSeverity.MEDIUM)]),
        _FakeResult(70.0, True, [_violation(RuleSeverity.MEDIUM)]),
    ], regen)
    assert run(orch.process(content="Draft.")).final_content == "Draft."


def test_time_budget_stops_the_loop_and_returns_the_best_version(monkeypatch):
    from agents.rule_engine import orchestrator as orch_mod
    from agents.rule_engine.rules.rule_models import RuleSeverity

    monkeypatch.setattr(orch_mod, "TIME_BUDGET_SECONDS", 0.0)
    regen: list = []
    orch = _orchestrator(monkeypatch, [_FakeResult(40.0, False, [_violation(RuleSeverity.HIGH)])], regen)
    result = run(orch.process(content="Draft."))
    assert not regen and result.total_iterations == 1 and result.final_content == "Draft."


# ── Voice measurement ─────────────────────────────────────────────────────────

def test_hard_wrapped_text_is_reflowed_and_paragraphs_are_not_reported():
    from services.voice import measure, describe

    sentence = "The brand explains its business in plain and steady language that anyone can follow"
    wrapped = "\n".join(
        f"{sentence[:45]}\n{sentence[45:]}." for _ in range(30)
    )
    profile = measure(wrapped)
    assert profile is not None
    assert profile["paragraph_sentences"] is None, "paragraph breaks are lost in a hard-wrapped extraction"
    assert 10 <= profile["sentence_mean"] <= 20, "wrapped lines must be joined before sentences are counted"
    assert "Paragraphs run" not in describe(profile)


def test_runs_of_table_cells_are_not_counted_as_one_giant_sentence():
    from services.voice import measure

    prose = "\n\n".join("A proper sentence of prose reads like this one does, with a clear point." for _ in range(12))
    cells = "\n".join(f"cell {i}" for i in range(120))
    profile = measure(prose + "\n\n" + cells)
    assert profile is not None and profile["sentence_max"] <= 60


# ── Provider health ───────────────────────────────────────────────────────────

def test_probe_reports_an_unusable_fallback(monkeypatch):
    import services.llm as llm

    async def ok(*a, **k):
        return "OK", 3

    async def no_credit(*a, **k):
        raise RuntimeError("Your credit balance is too low to access the Anthropic API")

    monkeypatch.setattr(llm, "OPENAI_KEY", "k")
    monkeypatch.setattr(llm, "ANTHROPIC_KEY", "k")
    monkeypatch.setattr(llm, "_DEFAULT_PREFER", "openai")
    monkeypatch.setattr(llm, "complete_openai", ok)
    monkeypatch.setattr(llm, "complete_claude", no_credit)
    result = run(llm.probe_providers(force=True))
    assert result["openai"]["ok"] is True and result["claude"]["ok"] is False
    assert "credit" in result["claude"]["error"] and result["fallback_usable"] is False


# ── Pipeline contract ─────────────────────────────────────────────────────────

def test_pipeline_adapts_word_count_to_the_format_and_says_so(monkeypatch):
    import importlib

    from fastapi.testclient import TestClient
    import main

    post = ("Reconciliation is plumbing. Credit unions close the books every month. "
            "The gap between the ledger and the bank costs them money.")

    def stub_for():
        async def stub(system, user, temperature=0.7, max_tokens=4096, prefer=None):
            if "json" in (system + user).lower():
                return json.dumps({"overallScore": 80, "passed": True, "violations": [], "rules": [],
                                   "unsupported": [], "content": post}), 10
            return post, 10
        return stub

    for mod in ["agents.canonical_writer", "agents.platform_optimizer", "agents.brand_optimizer",
                "agents.humanizer", "agents.qa_agent", "agents.refiner",
                "agents.rule_engine.agents.dynamic_rule_gen", "agents.rule_engine.agents.regeneration_agent",
                "agents.rule_engine.agents.static_validator", "services.pre_generation_validator"]:
        monkeypatch.setattr(importlib.import_module(mod), "complete", stub_for())

    resp = TestClient(main.app).post("/pipeline/run", json={
        "topic": "Why month-end close is broken", "targetPlatforms": ["linkedin_post"], "wordCount": 350,
        "brandProfile": {"name": "Acme", "tone_settings": CASUAL, "banned_phrases": ["disrupt"]},
    })
    assert resp.status_code == 200, resp.text[:400]
    warnings = resp.json()["warnings"]
    assert any("linkedin_post" in w and "350" in w and "300" in w for w in warnings), warnings


# ── QA flag triage ────────────────────────────────────────────────────────────

def test_a_critical_flag_that_concedes_support_becomes_a_warning():
    from agents.qa_agent import _triage_critical_flags, _count_critical_flags

    flags = ["fabricated_event: 'by 2015 delivery was the growth engine' \u2014 the profile says so, "
             "so this is supported"]
    out = _triage_critical_flags(flags, [], False)
    assert out[0].startswith("flag_withdrawn:") and _count_critical_flags(out) == 0


def test_event_flags_need_the_claim_audit_to_agree():
    from agents.qa_agent import _triage_critical_flags, _count_critical_flags

    flag = "fabricated_event: 'Classic founder move: we optimized the menu PDF' \u2014 no such story in the material"
    agreed = [{"sentence": "Classic founder move: we optimized the menu PDF while someone else took the order.",
               "reason": "invented past action"}]
    assert _count_critical_flags(_triage_critical_flags([flag], agreed, True)) == 1, \
        "an invented story the audit also finds must still fail the piece"
    unconfirmed = _triage_critical_flags([flag], [], True)
    assert unconfirmed[0].startswith("unconfirmed_claim:") and _count_critical_flags(unconfirmed) == 0
    # Without an audit there is no second opinion to wait for.
    assert _count_critical_flags(_triage_critical_flags([flag], None, False)) == 1


def test_invented_experience_stays_critical_whatever_the_audit_says():
    from agents.qa_agent import _triage_critical_flags, _count_critical_flags

    flag = "fabricated_experience: 'I spent 12 years building fleets' \u2014 not in the verified profile"
    assert _count_critical_flags(_triage_critical_flags([flag], [], True)) == 1


def test_banned_phrase_flag_is_critical_only_when_the_phrase_is_in_the_text():
    from agents.qa_agent import _triage_critical_flags, _count_critical_flags

    flag = "brand_banned_phrase: none present, but 'delivery boys' is not used"
    out = _triage_critical_flags([flag], [], False, content="Delivery partners bring food.", banned=["delivery boys"])
    assert _count_critical_flags(out) == 0
    flag = "banned_phrase: 'game-changing' appears in 'a game-changing app'"
    out = _triage_critical_flags([flag], [], False, content="A game-changing app.", banned=["game-changing"])
    assert _count_critical_flags(out) == 1


def test_a_flagged_phrase_the_brand_document_uses_word_for_word_is_withdrawn():
    from agents.qa_agent import _triage_critical_flags, _count_critical_flags

    material = "Operations span hundreds of Indian cities and many neighbourhoods."
    flag = "fabricated_metric: 'across hundreds of Indian cities' \u2014 vague scale claim"
    out = _triage_critical_flags([flag], [], True, material="Operations span across hundreds of Indian cities.")
    assert _count_critical_flags(out) == 0 and out[0].startswith("flag_withdrawn")
    # A quoted figure that is not in the material is still a failure.
    flag = "fabricated_metric: '47 countries' \u2014 not in the material"
    assert _count_critical_flags(_triage_critical_flags([flag], [], True, material=material)) == 1
