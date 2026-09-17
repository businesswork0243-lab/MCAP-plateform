# Testing the writing-quality work

M-CAP now measures how AI-sounding its own output is, feeds the offending
sentences back to the rewriter, and reports two advisory scores on the content
page. This is how to check that it does what it claims.

Everything below runs offline. No API key, no database, no Docker.

```bash
cd apps/ai-engine
pip install -r requirements.txt pytest
```

## 1. The test suite

```bash
python -m pytest tests/ -q
```

Expected: `102 passed`, in about three seconds.

## 2. The corpus density

```bash
python scripts/tell_score.py eval/corpus
```

Expected: `TOTAL 491 12 2.44` — 2.44 tells per 100 words across 491 words of
real pipeline output. All three of those samples passed every quality check the
product had before this work, which is the point.

```bash
python scripts/tell_score.py eval/corpus --check
```

Expected: `OK: 2.44 per 100 words, baseline 2.44`, exit code 0. This is the
command wired into CI, and it fails a release when density rises more than 15%
above the frozen baseline.

## 3. What actually changed in generation

Three things now happen that did not before.

**The rewriter is shown the sentence.** The humanizer prompt carries a
`WRITING PATTERNS FOUND` block quoting each offending sentence by name, instead
of a general instruction to sound human.

**The rule engine checks 22 more rules for free.** `SR017`–`SR038` are decided
by regex, not by the model, so they add no cost and keep reporting when the
provider is down. The seventeen LLM-judged rules are unchanged.

**The content page shows two advisory scores.** Structure and Voice Match, under
*Writing Quality*, with the reasons beneath them. Neither can block publishing —
only factual grounding does that.

To see the effect, generate a piece and compare against one made before this
release. What should change is construction, not content: fewer three-part
lists, fewer em dashes doing a comma's work, fewer one-line dramatic closers.

## 4. The part that needs your judgement

The tests prove the code does what it was told. They cannot tell us whether it
was told the right thing.

```bash
mkdir -p /tmp/mcap-check
# paste real posts into /tmp/mcap-check/*.txt — one file per piece
python scripts/tell_score.py /tmp/mcap-check
```

The scorer takes a **directory**, not a single file, and reads `.txt` and `.md`.

**False positives are the thing to hunt.** Feed it posts written by people,
ideally from the brands we generate for. Anything flagged there is a habit we
would be teaching the model to avoid for no reason. Em dashes and three-part
lists are the likeliest offenders; both are marked weak and need either three
hits or a second weak pattern before they count, but that rule is a judgement
call and your reading is what tests it.

**False negatives matter too.** Paste generated content that reads synthetic to
you. If it scores near zero, that gap is the most useful thing you can report.

**The advisory scores.** Structure penalises a piece for explaining its own
moral, naming nothing checkable, running on a single track and never addressing
the reader. Voice Match compares a draft's rhythm to the brand's uploaded
document. Both are heuristics with thresholds set by judgement rather than
measurement — if a piece you rate highly scores badly, say so.

`docs/PATTERNS.md` lists all 22 patterns, where each came from, and the licences.

## What is still missing

`eval/corpus/human/` is empty. Until it holds 10–15 posts written by people —
ideally from the brands we generate for — the baseline can tell us we are
getting worse but not that we are getting closer to how these people write.
That needs someone to supply the posts; no code will fix it.
