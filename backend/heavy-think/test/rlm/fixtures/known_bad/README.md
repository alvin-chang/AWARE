# known_bad fixture

This directory intentionally contains a non-PDF file with a `.pdf` extension.
Per SPEC §3.2 validation, `loadContext` should throw a clean `RlmConfigError`
(reason: PDF load fails). This exercises the "clean failure: RlmEnvironmentError
with partial_tree present" assertion from SPEC §9.2.

Note: the actual *file* with a misleading extension lives at
`fake.pdf` — see test/rlm/environment.test.js for the assertion.