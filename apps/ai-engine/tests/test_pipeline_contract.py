"""Contract test for the API worker -> AI engine boundary.

This boundary failed silently. contentWorker.ts posted a payload to
/pipeline/run, and FullPipelineRequest simply did not declare
tonalitySpectrum, wordCount, custom_structure_flow or reading_level.
Pydantic dropped them without a word, so the tone sliders and word count a
user set never reached the prompt compiler — which supported all of them.

Nothing in either language fails when a field goes missing, so this test
reads the keys the worker actually sends and asserts the model accepts
every one.
"""
import os
import re
import sys
from pathlib import Path

import pytest

AI_ENGINE = Path(__file__).resolve().parents[1]
REPO = AI_ENGINE.parents[1]
WORKER = REPO / "apps" / "api" / "src" / "jobs" / "workers" / "contentWorker.ts"

sys.path.insert(0, str(AI_ENGINE))
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")

from main import FullPipelineRequest  # noqa: E402


def worker_payload_keys() -> set[str]:
    """Keys of the object literal contentWorker.ts posts to /pipeline/run."""
    source = WORKER.read_text(encoding="utf-8")

    start = source.index("const payload = {")
    depth = 0
    for i in range(start, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                block = source[start : i + 1]
                break
    else:  # pragma: no cover - only if the literal is malformed
        pytest.fail("could not find the end of the payload literal")

    # top-level `key:` pairs, ignoring commented-out lines
    keys = set()
    for line in block.splitlines()[1:]:
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\s*:", stripped)
        if m:
            keys.add(m.group(1))
    return keys


def test_worker_payload_is_readable():
    keys = worker_payload_keys()
    assert "topic" in keys, "payload extraction found nothing recognisable"
    assert len(keys) > 10


def test_every_field_the_worker_sends_is_declared_on_the_model():
    sent = worker_payload_keys()
    declared = set(FullPipelineRequest.model_fields.keys())
    dropped = sent - declared
    assert not dropped, (
        "FullPipelineRequest would silently discard these fields the worker "
        f"sends: {sorted(dropped)}. Declare them on the model and pass them "
        "into PDLRequest, or stop sending them from the worker."
    )


@pytest.mark.parametrize(
    "field",
    ["tonalitySpectrum", "wordCount", "custom_structure_flow", "reading_level"],
)
def test_previously_dropped_fields_are_declared(field):
    """These four were the ones actually lost in production."""
    assert field in FullPipelineRequest.model_fields


def test_model_accepts_a_full_worker_payload():
    req = FullPipelineRequest(
        topic="Scalability is more than transaction speed",
        objective="Build thought leadership",
        context="",
        audience="B2B SaaS founders",
        icp_description="",
        perspective="Founder",
        writing_structure="thesis",
        cta="comment",
        targetPlatforms=["linkedin_post"],
        brandProfile=None,
        enableHumanization=True,
        humanizationIntensity="medium",
        enableQA=True,
        language="English",
        keywords=[],
        specialInstructions="",
        seoEnabled=False,
        seoSettings={},
        tonalitySpectrum={"excited": 8, "confident": 9},
        wordCount=800,
        custom_structure_flow=["Hook", "Data", "CTA"],
        reading_level="Executive",
    )
    assert req.wordCount == 800
    assert req.tonalitySpectrum["confident"] == 9
    assert req.custom_structure_flow == ["Hook", "Data", "CTA"]


def test_an_older_payload_without_the_new_fields_still_parses():
    """A job queued before the fields existed must not fail on the way out."""
    req = FullPipelineRequest(topic="Anything", targetPlatforms=["linkedin_post"])
    assert req.wordCount is None
    assert req.tonalitySpectrum == {}
    assert req.custom_structure_flow is None
    assert req.reading_level == "Professional"


def test_values_survive_into_the_prompt_compiler():
    """Declaring the fields is not enough — they have to reach the prompt."""
    from services.prompt_compiler import PDLRequest, compile as compile_prompt

    pkg = compile_prompt(
        PDLRequest(
            topic="Scalability",
            platforms=["linkedin_post"],
            tonality_spectrum={"excited": 8, "confident": 9},
            word_count=800,
        )
    )
    ci = pkg.canonical_instructions
    assert ci["word_count"] == 800
    assert ci["tonality_spectrum"]["confident"] == 9
    assert "confident" in pkg.metadata["tonality_active"]
