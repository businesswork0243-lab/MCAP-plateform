"""Contract test for brand profile data reaching the prompts.

BrandProfile did not declare website, description, vision, positioning,
value_propositions, industry_vocabulary or example_content. Pydantic dropped
them without a word, so the brand page saved them and no agent ever saw
them. A NULL in any optional text column also failed the whole request with
422, because None is not a str.

This reads the brand_profiles columns from the migrations, so a column added
later without engine support fails here, then runs the real /pipeline/run
with a stubbed LLM and checks each field's value lands in a prompt.
"""
import json
import os
import re
import sys
from pathlib import Path

import pytest

AI_ENGINE = Path(__file__).resolve().parents[1]
REPO = AI_ENGINE.parents[1]
MIGRATIONS = REPO / "migrations"

sys.path.insert(0, str(AI_ENGINE))
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")

import main  # noqa: E402
from main import BrandProfile  # noqa: E402

# Bookkeeping columns, and tone_* which arrive folded into tone_settings.
NOT_CONTENT = {"id", "organization_id", "client_id", "is_default", "created_at", "updated_at"}


def brand_profile_columns() -> set[str]:
    cols: set[str] = set()
    for sql_file in sorted(MIGRATIONS.glob("*.sql")):
        sql = sql_file.read_text(encoding="utf-8")
        for block in re.findall(r"CREATE TABLE\s+brand_profiles\s*\((.*?)\n\);", sql, re.S):
            for line in block.splitlines():
                m = re.match(r"\s*([a-z_]+)\s+[A-Z]", line)
                if m:
                    cols.add(m.group(1))
        for block in re.findall(r"ALTER TABLE\s+brand_profiles(.*?);", sql, re.S):
            cols.update(re.findall(r"ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z_]+)", block))
    return cols


def test_migrations_are_readable():
    cols = brand_profile_columns()
    assert {"name", "mission", "banned_phrases", "life_purpose"} <= cols


def test_every_brand_column_is_declared_on_the_model():
    content_cols = {
        c for c in brand_profile_columns()
        if c not in NOT_CONTENT and not c.startswith("tone_")
    }
    dropped = content_cols - set(BrandProfile.model_fields)
    assert not dropped, (
        "BrandProfile would silently discard these brand_profiles columns: "
        f"{sorted(dropped)}. Declare them on the model and use them in a prompt."
    )


def test_null_columns_do_not_reject_the_brand():
    profile = BrandProfile(
        name="Acme", mission=None, vision=None, compliance_notes=None,
        industry=None, life_purpose=None, value_propositions=None,
    )
    assert profile.mission == "" and profile.value_propositions == []


def test_flat_tone_columns_become_tone_settings():
    profile = BrandProfile(name="Acme", tone_formality=9, tone_humor=1)
    assert profile.as_dict()["tone_settings"] == {"formality": 9, "humor": 1}


# ── End to end: every field's value lands in a prompt ────────────────────────

BRAND = {
    "id": "00000000-0000-0000-0000-000000000001",
    "organization_id": "00000000-0000-0000-0000-000000000002",
    "name": "Zorbix Analytics",
    "website": "https://canary-website.example",
    "industry": "CANARY_INDUSTRY",
    "description": "CANARY_DESCRIPTION",
    "mission": "CANARY_MISSION",
    "vision": "CANARY_VISION",
    "positioning": "CANARY_POSITIONING",
    "life_purpose": "CANARY_LIFE_PURPOSE",
    "tone_formality": 8, "tone_technical": 9,
    "preferred_terms": ["CANARY_TERM"],
    "banned_phrases": ["CANARY_BANNED"],
    "industry_vocabulary": ["CANARY_VOCAB"],
    "key_messages": ["CANARY_KEYMSG"],
    "value_propositions": ["CANARY_VALUEPROP"],
    "compliance_notes": "CANARY_COMPLIANCE",
    "example_content": ["CANARY_EXAMPLE"],
    "likes": ["CANARY_LIKES"], "hates": ["CANARY_HATES"], "dislikes": ["CANARY_DISLIKES"],
    "stands_for": ["CANARY_STANDS_FOR"], "stands_against": ["CANARY_STANDS_AGAINST"],
    "core_values": ["CANARY_CORE_VALUES"], "core_motivations": ["CANARY_MOTIVATIONS"],
    "document_context": "=== guide.pdf ===\nCANARY_DOCUMENT We write short, flat sentences.",
    "has_documents": True, "document_count": 1,
    "created_at": None, "updated_at": None,
}

# field -> (marker, agents whose prompt must contain it)
EXPECTED = {
    "name":                ("Zorbix",                 {"canonical_writer", "brand_optimizer"}),
    "website":             ("canary-website.example", {"canonical_writer"}),
    "industry":            ("CANARY_INDUSTRY",        {"canonical_writer"}),
    "description":         ("CANARY_DESCRIPTION",     {"canonical_writer", "brand_optimizer"}),
    "mission":             ("CANARY_MISSION",         {"canonical_writer", "brand_optimizer"}),
    "vision":              ("CANARY_VISION",          {"canonical_writer", "brand_optimizer"}),
    "positioning":         ("CANARY_POSITIONING",     {"canonical_writer", "brand_optimizer"}),
    "life_purpose":        ("CANARY_LIFE_PURPOSE",    {"canonical_writer", "brand_optimizer"}),
    "preferred_terms":     ("CANARY_TERM",            {"canonical_writer", "brand_optimizer"}),
    "banned_phrases":      ("CANARY_BANNED",          {"brand_optimizer", "humanizer"}),
    "industry_vocabulary": ("CANARY_VOCAB",           {"canonical_writer", "brand_optimizer"}),
    "key_messages":        ("CANARY_KEYMSG",          {"canonical_writer", "brand_optimizer"}),
    "value_propositions":  ("CANARY_VALUEPROP",       {"canonical_writer", "brand_optimizer"}),
    "compliance_notes":    ("CANARY_COMPLIANCE",      {"canonical_writer", "brand_optimizer"}),
    "example_content":     ("CANARY_EXAMPLE",         {"brand_optimizer"}),
    "likes":               ("CANARY_LIKES",           {"brand_optimizer"}),
    "hates":               ("CANARY_HATES",           {"brand_optimizer"}),
    "dislikes":            ("CANARY_DISLIKES",        {"brand_optimizer"}),
    "stands_for":          ("CANARY_STANDS_FOR",      {"canonical_writer", "brand_optimizer"}),
    "stands_against":      ("CANARY_STANDS_AGAINST",  {"canonical_writer", "brand_optimizer"}),
    "core_values":         ("CANARY_CORE_VALUES",     {"canonical_writer", "brand_optimizer"}),
    "core_motivations":    ("CANARY_MOTIVATIONS",     {"brand_optimizer"}),
    "document_context":    ("CANARY_DOCUMENT",        {"canonical_writer", "brand_optimizer"}),
    "tone_settings":       ("Formality:      8/10",   {"brand_optimizer"}),
}

STUB_MODULES = [
    "agents.canonical_writer", "agents.platform_optimizer", "agents.brand_optimizer",
    "agents.humanizer", "agents.qa_agent", "agents.refiner",
    "agents.rule_engine.agents.dynamic_rule_gen",
    "agents.rule_engine.agents.regeneration_agent",
    "agents.rule_engine.agents.static_validator",
    "services.pre_generation_validator",
]

FAKE_POST = "Reconciliation is plumbing. Credit unions close books monthly. That gap costs money."


@pytest.fixture(scope="module")
def prompts_by_agent():
    import importlib

    from fastapi.testclient import TestClient

    captured: dict[str, str] = {}

    def stub_for(agent):
        async def stub(system, user, temperature=0.7, max_tokens=4096, prefer=None):
            captured[agent] = captured.get(agent, "") + system + "\n" + user
            if "json" in (system + user).lower():
                return json.dumps({"overallScore": 80, "passed": True, "issues": [],
                                   "violations": [], "rules": [], "content": FAKE_POST}), 10
            return FAKE_POST, 10
        return stub

    patch = pytest.MonkeyPatch()
    for mod in STUB_MODULES:
        patch.setattr(importlib.import_module(mod), "complete", stub_for(mod.split(".")[-1]))
    try:
        resp = TestClient(main.app).post("/pipeline/run", json={
            "topic": "Why month-end close is broken",
            "targetPlatforms": ["linkedin_post"],
            "brandProfile": BRAND,
        })
    finally:
        patch.undo()
    assert resp.status_code == 200, resp.text[:500]
    return captured


@pytest.mark.parametrize("field", sorted(EXPECTED))
def test_brand_field_reaches_its_agents(field, prompts_by_agent):
    marker, agents = EXPECTED[field]
    missing = {a for a in agents if marker not in prompts_by_agent.get(a, "")}
    assert not missing, f"brand field {field!r} never reached the prompt of {sorted(missing)}"
