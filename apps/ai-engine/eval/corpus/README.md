# Evaluation corpus

Frozen samples used to measure whether M-CAP's writing is getting better or
worse. Without this, every claim of improvement is unfalsifiable.

```bash
cd apps/ai-engine
python scripts/tell_score.py eval/corpus                  # report
python scripts/tell_score.py eval/corpus --save-baseline  # freeze the number
python scripts/tell_score.py eval/corpus --check          # what CI runs
```

## Layout

```
eval/corpus/
  generated/   real M-CAP output, unedited  — drives the baseline and the gate
  human/       posts written by people      — the direction, never the gate
  baseline.json
```

## The two sides are scored apart, deliberately

Only `generated/` moves the baseline and `--check`. Human writing carries fewer
tells, so pooling the two would pull the average down and let a real regression
in our own output pass — filling in the human corpus would have quietly
disarmed the gate that the corpus exists to feed.

`human/` answers the other question. `generated/` tells us whether we are
getting worse. `human/` tells us whether we are getting closer to how the
people we write for actually write. The report prints the gap between them.

## Rules for adding a generated sample

- **Unedited.** Paste exactly what the pipeline produced. Cleaning it up first
  defeats the purpose.
- **Say where it came from.** The `---` front matter is ignored by the scorer,
  so record the brand, structure, platform and date there.
- **Never edit a sample to make the number go down.** Change the pipeline, not
  the corpus. If a sample is no longer representative, delete it and say so in
  the commit.

## Adding a human sample

See `human/README.md`. The short version: it has to be something a person
actually wrote and published, pasted unchanged, with its source recorded. A
model's output filed there would set the target to a model's writing, and every
later comparison would look healthy while measuring nothing.

The scorer rejects samples carrying chatbot residue and CI fails on them, which
catches the careless case but not a careful one.
