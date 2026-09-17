"""The corpus scorer, and the trap in filling it in.

The human reference posts the plan asks for would, under the original scorer,
have been swept into the same average as our own output. Human writing carries
fewer tells, so adding them would have pulled the number down and let a real
regression pass `--check`. Completing the corpus would have disarmed the gate
that the corpus exists to feed.

These tests pin the separation, and the refusal to accept a "human" sample that
came out of a chatbot.
"""
import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

AI_ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_ENGINE))
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-used")

_spec = importlib.util.spec_from_file_location(
    "tell_score", AI_ENGINE / "scripts" / "tell_score.py"
)
tell_score = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tell_score)


# Tell-bearing: a forced triad and an em dash doing a comma's work.
GENERATED = (
    "Most teams benchmark throughput in transactions per second. They optimize "
    "consensus efficiency, compress signatures, and shard execution—as if the "
    "network were a single machine. But the binding constraint lives elsewhere."
)

# Written the way a person writes: no triads, no dashes, addresses the reader.
HUMAN = (
    "We moved the billing service off the monolith last spring. It took four "
    "months and two false starts. The first attempt failed because we tried to "
    "move the database at the same time, which meant every rollback touched "
    "customer records. What finally worked was boring. One person owned the "
    "date. You could argue we should have known that from the start, and you "
    "would be right."
)

RESIDUE = (
    "Great question. Here is how we handled the billing migration last spring. "
    "We moved the service off the monolith over four months. I hope this helps."
)


@pytest.fixture
def corpus(tmp_path: Path) -> Path:
    root = tmp_path / "corpus"
    (root / "generated").mkdir(parents=True)
    (root / "generated" / "a.txt").write_text(GENERATED, encoding="utf-8")
    return root


def _add_human(corpus: Path, name: str, text: str) -> None:
    human = corpus / "human"
    human.mkdir(exist_ok=True)
    (human / name).write_text(text, encoding="utf-8")


# ─── The separation ───────────────────────────────────────────────────────────

def test_human_samples_do_not_move_the_generated_density(corpus: Path):
    before = tell_score.score_corpus(corpus)["tells_per_100_words"]
    _add_human(corpus, "a.txt", HUMAN)
    after = tell_score.score_corpus(corpus)["tells_per_100_words"]
    assert after == before


def test_human_samples_are_not_counted_as_files(corpus: Path):
    _add_human(corpus, "a.txt", HUMAN)
    assert tell_score.score_corpus(corpus)["files"] == 1


def test_the_human_side_is_reported_separately(corpus: Path):
    assert tell_score.score_human(corpus) is None
    _add_human(corpus, "a.txt", HUMAN)
    human = tell_score.score_human(corpus)
    assert human is not None
    assert human["files"] == 1
    # The reference should be cleaner than our output; that gap is the point.
    assert human["tells_per_100_words"] < (
        tell_score.score_corpus(corpus)["tells_per_100_words"]
    )


def test_pooling_would_have_lowered_the_number(corpus: Path):
    """The bug this guards against, stated as arithmetic."""
    _add_human(corpus, "a.txt", HUMAN)
    generated = tell_score.score_corpus(corpus)
    human = tell_score.score_human(corpus)

    pooled = (
        (generated["effective_tells"] + human["effective_tells"])
        / (generated["words"] + human["words"]) * 100
    )
    assert pooled < generated["tells_per_100_words"], (
        "if this ever stops holding, the samples are no longer representative"
    )


# ─── Refusing a poisoned reference ────────────────────────────────────────────

def test_chatbot_residue_is_flagged(corpus: Path):
    _add_human(corpus, "suspect.txt", RESIDUE)
    human = tell_score.score_human(corpus)
    assert tell_score._residue_warnings(human) == ["human/suspect.txt"]


def test_clean_human_sample_is_not_flagged(corpus: Path):
    _add_human(corpus, "fine.txt", HUMAN)
    assert tell_score._residue_warnings(tell_score.score_human(corpus)) == []


def test_check_fails_on_a_poisoned_reference(corpus: Path, monkeypatch, capsys):
    tell_score.score_corpus(corpus)
    monkeypatch.setattr(sys, "argv", ["tell_score.py", str(corpus), "--save-baseline"])
    assert tell_score.main() == 0

    _add_human(corpus, "suspect.txt", RESIDUE)
    monkeypatch.setattr(sys, "argv", ["tell_score.py", str(corpus), "--check"])
    assert tell_score.main() == 1
    assert "chatbot residue" in capsys.readouterr().out


# ─── The baseline ─────────────────────────────────────────────────────────────

def test_baseline_gate_figure_excludes_the_human_side(corpus: Path, monkeypatch):
    _add_human(corpus, "a.txt", HUMAN)
    monkeypatch.setattr(sys, "argv", ["tell_score.py", str(corpus), "--save-baseline"])
    assert tell_score.main() == 0

    saved = json.loads((corpus / "baseline.json").read_text(encoding="utf-8"))
    assert saved["tells_per_100_words"] == (
        tell_score.score_corpus(corpus)["tells_per_100_words"]
    )
    # Recorded for context, kept out of the gate.
    assert saved["human_reference"]["files"] == 1


def test_adding_reference_posts_cannot_loosen_the_gate(corpus: Path, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["tell_score.py", str(corpus), "--save-baseline"])
    tell_score.main()

    _add_human(corpus, "a.txt", HUMAN)
    monkeypatch.setattr(sys, "argv", ["tell_score.py", str(corpus), "--check"])
    assert tell_score.main() == 0

    # And a genuine regression still fails, human corpus or not.
    (corpus / "generated" / "b.txt").write_text(GENERATED * 3, encoding="utf-8")
    (corpus / "generated" / "a.txt").write_text(
        GENERATED + " Great question. It is a journey, not a destination.",
        encoding="utf-8",
    )
    assert tell_score.main() == 1


# ─── Ad-hoc folders still work ────────────────────────────────────────────────

def test_a_plain_folder_of_pasted_text_is_supported(tmp_path: Path):
    """Documented in docs/TESTING.md for checking your own posts."""
    folder = tmp_path / "scratch"
    folder.mkdir()
    (folder / "one.txt").write_text(GENERATED, encoding="utf-8")
    result = tell_score.score_corpus(folder)
    assert result["files"] == 1


def test_an_empty_corpus_is_an_error(tmp_path: Path):
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(SystemExit):
        tell_score.score_corpus(empty)
