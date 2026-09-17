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
  generated/   real M-CAP output, unedited
  human/       posts written by people, for direction
  baseline.json
```

## Rules for adding a sample

- **Unedited.** Paste exactly what the pipeline produced. Cleaning it up first
  defeats the purpose.
- **Say where it came from.** The `---` front matter is ignored by the scorer,
  so record the brand, structure, platform and date there.
- **Never edit a sample to make the number go down.** Change the pipeline, not
  the corpus. If a sample is no longer representative, delete it and say so in
  the commit.

## `human/` is deliberately thin

Measuring our own output against itself shows change but not direction. To know
whether we are moving toward how these people actually write, the corpus needs
their real posts: 10 to 15 pieces, ideally from the same brands we generate for.

Until those land, treat the baseline as "are we getting worse" rather than
"are we getting closer to human".
