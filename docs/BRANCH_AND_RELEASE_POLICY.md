# Branch and release policy

- `main` must pass lint, type checking, unit tests, renderer build, Rust tests, Swift probe build,
  and the dependency audit.
- Use short-lived feature branches and merge only with reviewable acceptance evidence.
- Experimental trackers stay behind a feature flag and cannot become the primary provider without a
  same-corpus benchmark.
- Schema migrations are tested against a copy of local metadata before release.
- Model and tracker versions are pinned; stable releases never upgrade them automatically.
- Release tags are signed when distribution begins.
- Hardware acceptance reports and known limitations accompany every beta.
