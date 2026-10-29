"""Follow-up fixes from the walkthrough report.

The first round (test_walkthrough_findings.py) fixed what the report found. This
covers what it said was only partly fixed: a brand optimizer that left the tone
alone, long brand documents that were cut off, a voice target that contradicted
the tone sliders, rhythm and address that nothing checked, and a fallback
provider that could be dead without anyone knowing. Every LLM call is stubbed.
"""
import asyncio
import logging
import os
import sys
from pathlib import Path

AI_ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ENGINE))
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")


def run(coro):
    return asyncio.run(coro)


# ── Rhythm, address and cohesion tells ────────────────────────────────────────

def ids_in(text):
    from services.tells import find_tells
    return {t["id"] for t in find_tells(text)}


def test_run_of_short_sentences_is_found():
    assert "TELL34" in ids_in("Menus came first. Orders came next. Delivery came last. Then growth followed slowly.")


def test_fragment_overuse_needs_a_quarter_of_the_sentences():
    fragments = "Menus first. Orders next. Delivery last. Scale follows. "
    longer = "The directory grew into a marketplace because restaurants wanted orders and customers wanted delivery. "
    assert "TELL35" in ids_in(fragments * 2 + longer * 2)
    assert "TELL35" not in ids_in(longer * 8)


def test_a_long_piece_that_never_says_you_is_found_and_one_that_does_is_not():
    third_person = "The platform coordinates restaurants and couriers across the city. " * 18
    spoken_to = third_person + "You can see why your own product might need the same. " * 2
    assert "TELL36" in ids_in(third_person)
    assert "TELL36" not in ids_in(spoken_to)
    assert "TELL36" not in ids_in("Short post, no address needed here at all.")


def test_staccato_assertions_that_do_not_connect_are_found():
    disconnected = (
        "Discovery is a one-time job. Ordering is the business. Operations is the product. "
        "Density wins cities. Trust compounds slowly. Scale hides weakness. Speed matters less "
        "than reliability. Partners are the supply. Customers are the demand. Margins follow habits."
    )
    connected = (
        "The directory listed menus. Those menus drew visitors. Visitors wanted to order, so the "
        "company added ordering. Ordering needed couriers, because someone had to carry the food. "
        "The couriers needed routes, and routes needed density. Density made each delivery cheaper, "
        "which made the next order easier to win. That loop then pulled in more restaurants."
    )
    assert "TELL37" in ids_in(disconnected)
    assert "TELL37" not in ids_in(connected)


def test_new_tells_have_rule_ids_and_fixes():
    from agents.rule_engine.rules.tell_rules import TELL_RULE_IDS, FIXES

    for pid, rid in (("TELL34", "SR048"), ("TELL35", "SR049"), ("TELL36", "SR050"), ("TELL37", "SR051")):
        assert TELL_RULE_IDS[pid] == rid and FIXES[pid]


# ── Measured tone ─────────────────────────────────────────────────────────────

SPOKEN_GAP_TEXT = (
    "The platform does not employ the couriers it relies on. It is a marketplace, and that is "
    "the whole difficulty. We are not the kitchen and we are not the road. "
) * 4


def test_tone_gaps_name_the_missing_register():
    from services.brand_tone import gaps

    codes = {code for code, _ in gaps(SPOKEN_GAP_TEXT, {"formality": 2})}
    assert codes == {"contractions", "address"}
    contracted = SPOKEN_GAP_TEXT.replace("does not", "doesn't").replace("It is", "It's") * 2
    assert {code for code, _ in gaps(contracted, {"formality": 9})} == {"expand"}
    assert gaps("Too short.", {"formality": 2}) == [] and gaps(SPOKEN_GAP_TEXT, {}) == []


def test_contract_and_expand_leave_quotes_alone():
    from services.brand_tone import contract, expand

    text = 'We do not know. It is clear that "it is not here" holds. The team cannot say.'
    short = contract(text)
    assert "don't" in short and '"it is not here"' in short
    assert "do not" in expand(short) and '"it is not here"' in expand(short)


def test_brand_optimizer_enforces_the_register_it_measured(monkeypatch):
    from agents import brand_optimizer

    draft = (
        "The platform does not employ the couriers it relies on. The marketplace depends on partners. "
        "Restaurants control preparation and couriers control the last mile, so reliability is shared. "
        "That is why local density matters more than national reach. "
    ) * 3
    spoken = draft.replace("does not", "doesn't") + " You can feel that in your own city."
    replies = iter([draft, spoken])
    systems: list = []

    async def stub(system, user, temperature=0.7, max_tokens=4096, prefer=None):
        systems.append(system)
        return next(replies), 10

    monkeypatch.setattr(brand_optimizer, "complete", stub)
    out = run(brand_optimizer.run(draft, {"name": "Acme", "tone_settings": {"formality": 2}}))
    assert "You can feel that" in out["content"], "the retry that fixed the register must be kept"
    assert len(systems) == 2 and systems[1] == brand_optimizer.RETRY_SYSTEM


def test_brand_optimizer_discards_a_retry_that_drops_a_figure(monkeypatch):
    from agents import brand_optimizer

    draft = (
        "The platform recorded 979 million orders and does not employ the couriers it relies on. "
        "Restaurants control preparation and couriers control the last mile, so reliability is shared. "
    ) * 3
    bad = draft.replace("979 million", "many").replace("does not", "doesn't") + " You know this."
    replies = iter([draft, bad])

    async def stub(system, user, temperature=0.7, max_tokens=4096, prefer=None):
        return next(replies), 10

    monkeypatch.setattr(brand_optimizer, "complete", stub)
    out = run(brand_optimizer.run(draft, {"name": "Acme", "tone_settings": {"formality": 2}}))
    assert "979 million" in out["content"] and "You know this" not in out["content"]


# ── Brand brief ───────────────────────────────────────────────────────────────

LONG_DOC = "Foodiebay began in 2008 as a menu directory. It reached 979 million orders in FY2026. " * 400


def test_a_short_document_is_not_condensed(monkeypatch):
    from services import brand_brief

    async def boom(*a, **k):
        raise AssertionError("no model call expected")

    monkeypatch.setattr(brand_brief, "complete", boom)
    profile = {"document_context": "A short document."}
    out, tokens = run(brand_brief.attach(profile))
    assert out is profile and tokens == 0


def test_a_long_document_becomes_a_brief_and_the_original_is_kept(monkeypatch):
    from services import brand_brief

    brand_brief._CACHE.clear()
    brief_text = "FACTS AND FIGURES\n" + "Foodiebay began in 2008. It reached 979 million orders in FY2026.\n" * 12

    async def stub(system, user, temperature=0.7, max_tokens=4096, prefer=None):
        return brief_text, 500

    monkeypatch.setattr(brand_brief, "complete", stub)
    out, tokens = run(brand_brief.attach({"document_context": LONG_DOC, "name": "Acme"}))
    assert out["document_full"] == LONG_DOC.strip() and tokens == 500
    assert out["document_context"].startswith("BRAND BRIEF") and "979 million" in out["document_context"]
    _, again = run(brand_brief.attach({"document_context": LONG_DOC}))
    assert again == 0, "the same document must be served from the cache"


def test_a_brief_with_an_invented_figure_is_discarded(monkeypatch):
    from services import brand_brief

    brand_brief._CACHE.clear()

    async def stub(system, user, temperature=0.7, max_tokens=4096, prefer=None):
        return "FACTS\n" + "Foodiebay served 3.2 billion orders across 47 countries in 2019.\n" * 20, 400

    monkeypatch.setattr(brand_brief, "complete", stub)
    profile = {"document_context": LONG_DOC}
    out, _ = run(brand_brief.attach(profile))
    assert out is profile and "document_full" not in out


def test_source_document_prefers_the_original_over_the_brief():
    from services.verified_facts import source_document

    assert source_document({"document_full": "ORIGINAL", "document_context": "BRIEF"}) == "ORIGINAL"
    assert source_document({"document_context": "ONLY"}) == "ONLY" and source_document(None) == ""


def test_the_pipeline_sends_the_brief_to_the_writer_and_the_original_to_the_checks(monkeypatch):
    import importlib
    import json

    from fastapi.testclient import TestClient

    import main
    from services import brand_brief

    brand_brief._CACHE.clear()
    brief_text = "FACTS AND FIGURES\n" + "Foodiebay began in 2008. It reached 979 million orders in FY2026.\n" * 12
    writer_prompts: list = []
    post = ("Reconciliation is plumbing. Credit unions close the books every month. "
            "The gap between the ledger and the bank costs them money.")

    def stub_for(name):
        async def stub(system, user, temperature=0.7, max_tokens=4096, prefer=None):
            if name == "brand_brief":
                return brief_text, 500
            if name == "canonical_writer":
                writer_prompts.append(user)
            if "json" in (system + user).lower():
                return json.dumps({"overallScore": 80, "passed": True, "violations": [], "rules": [],
                                   "unsupported": [], "content": post}), 10
            return post, 10
        return stub

    for mod in ["services.brand_brief", "agents.canonical_writer", "agents.platform_optimizer",
                "agents.brand_optimizer", "agents.humanizer", "agents.qa_agent", "agents.refiner",
                "agents.rule_engine.agents.dynamic_rule_gen", "agents.rule_engine.agents.regeneration_agent",
                "agents.rule_engine.agents.static_validator", "services.pre_generation_validator"]:
        monkeypatch.setattr(importlib.import_module(mod), "complete", stub_for(mod.split(".")[-1]))

    resp = TestClient(main.app).post("/pipeline/run", json={
        "topic": "Why month-end close is broken", "targetPlatforms": ["linkedin_post"],
        "brandProfile": {"name": "Acme", "document_context": LONG_DOC},
    })
    assert resp.status_code == 200, resp.text[:400]
    assert writer_prompts and "BRAND BRIEF" in writer_prompts[0], "the writer must be given the brief"
    assert LONG_DOC[:400] not in writer_prompts[0], "the writer must not be given the truncated original as well"


# ── Voice target ──────────────────────────────────────────────────────────────

def test_voice_target_never_forbids_first_person_and_respects_a_casual_tone():
    from services.voice import describe, measure

    formal = "The committee reviews each proposal in full before it votes on the outcome. " * 24
    profile = measure(formal)
    assert "impersonal" not in describe(profile).lower()
    assert "Never uses contractions" in describe(profile)
    assert "Never uses contractions" not in describe(profile, {"formality": 2})


# ── Startup provider report ───────────────────────────────────────────────────

def test_startup_report_logs_an_unusable_fallback(monkeypatch, caplog):
    import main
    import services.llm as llm

    async def fake_probe(force=False):
        return {"primary": "openai", "openai": {"configured": True, "ok": True},
                "claude": {"configured": True, "ok": False, "error": "out of credit"}, "fallback_usable": False}

    monkeypatch.setattr(llm, "probe_providers", fake_probe)
    with caplog.at_level(logging.WARNING, logger="ai-engine"):
        run(main._report_provider_health())
    assert "claude" in caplog.text and "out of credit" in caplog.text and "No usable fallback" in caplog.text
