"""The grounding check can only call a claim supported if it can see the support."""
from services.verified_facts import build_verified_material, DOCUMENT_CHARS


def test_document_and_profile_both_reach_the_checker():
    out = build_verified_material({
        "name": "Ledgerline", "document_context": "We started in 2021 after a failed bridge transfer.",
    })
    assert "Ledgerline" in out and "We started in 2021" in out


def test_no_profile_means_no_material():
    assert build_verified_material(None) == ""
    assert build_verified_material({}) == ""


def test_document_is_capped():
    out = build_verified_material({"document_context": "x" * (DOCUMENT_CHARS * 3)})
    assert len(out) < DOCUMENT_CHARS + 200
