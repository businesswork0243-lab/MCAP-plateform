# Testing the `test/anti-slop` branch

This branch adds a way to **measure** how AI-sounding M-CAP's writing is. It
does not yet change what the product generates.

That distinction matters for what you should test. `services/tells.py` is
imported only by the tests and the scorer — no pipeline agent calls it. So
generating content from the app will produce exactly what it produced before.
What is new is a ruler, and the thing worth testing is whether the ruler is
honest.

## Setup

```bash
git clone https://github.com/businesswork0243-lab/MCAP-plateform.git
cd MCAP-plateform
git checkout test/anti-slop

cd apps/ai-engine
pip install -r requirements.txt pytest
```

No API key, no database and no Docker needed. The detectors are pure regex and
run offline.

## 1. The test suite should pass

```bash
python -m pytest tests/test_tells.py -q
```

Expected: `29 passed`, in well under a second.

## 2. The scorer should report the frozen numbers

```bash
python scripts/tell_score.py eval/corpus
```

Expected:

```
TOTAL                                           491     12    2.44
```

2.44 tells per 100 words, across 491 words of real pipeline output. All three
of those samples passed every quality check the product had at the time, which
is the point: the existing checks were not catching this.

## 3. The CI gate should pass

```bash
python scripts/tell_score.py eval/corpus --check
```

Expected: `OK: 2.44 per 100 words, baseline 2.44` and exit code 0. This is the
command wired into `.github/workflows/deploy.yml`, and it fails a release when
the density rises more than 15% above the baseline.

## 4. The part that actually needs your judgement

Run the detectors over writing you know well and decide whether you agree with
what they flag.

```bash
mkdir -p /tmp/mcap-check
# paste real posts into /tmp/mcap-check/*.txt — one file per piece
python scripts/tell_score.py /tmp/mcap-check
```

The scorer needs a **directory**, not a single file. It reads `.txt` and `.md`,
and ignores a leading `---` front-matter block.

Two questions are worth more than the numbers:

**False positives.** Feed it posts written by people — ideally from the brands
we generate for. Anything it flags there is a pattern we would be teaching the
model to avoid for no reason. Em-dashes (TELL08) and three-part lists (TELL06)
are the likeliest offenders; both are marked weak and need either 3 hits or a
second weak pattern before they count, but that heuristic is a guess and is
exactly what your reading should check.

**False negatives.** Paste generated content that reads obviously synthetic to
you and see whether the score reflects it. If something sounds like a machine
wrote it and scores near zero, that gap is the most useful thing you can report.

`docs/PATTERNS.md` lists all 21 patterns, where each came from, and their
licences.

## Reporting

Comment on the pull request. For a disputed detection, paste the sentence and
say which pattern fired and whether you think it should have. For a miss, paste
the text and what sounds wrong about it.

## What is not in this branch

Wiring the detectors into the humanizer so generation actually improves is
P3–P5 of `docs/anti-slop-implementation.md`, and it is parked on four open
decisions. Measuring first is deliberate: without a frozen baseline there is no
way to prove a later change helped.
