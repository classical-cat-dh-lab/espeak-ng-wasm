# AGENTS.md — espeak-ng-wasm

> Project-level instructions for agent work in this repo. Keep lean.

## What this repo is

Lab-owned (Classical Cat Digital Humanities Lab), **public** OSS repo: reproducible
WebAssembly builds of eSpeak NG + minimal IPA-input driver. Consumers: Porphyrii
(student project) and future lab projects. Everything here is public-facing — write
docs, comments, and commit messages in English; no internal governance notes, no
Chinese-language ops content.

## Hard rules

- **GPLv3 discipline**: artifacts are eSpeak NG derivatives. LICENSE stays at repo
  root and ships with releases; upstream attribution (Isaacson, Pettarin) stays in
  README. Never remove.
- **No secrets in this repo, ever.** Push credentials live outside the repo on the
  maintainer's machine (OS keychain, read by a local credential helper); tokens never
  touch `.git/config`, files in this repo, or conversation plaintext.
- **This file is public.** Content rule: contribution/build/test rules only — nothing
  here may reveal internal ops topology (credential locations, infra layout, account
  structure). Internal ops details live in the lab's private ops docs, never here.
- **Deterministic paths**: data trimming is scripted (`trim-data.sh`), never manual;
  builds pin upstream tag + emsdk version and record them in `manifest.json`.
- **Long builds** run via `nohup ... > build.log 2>&1 &` + manual tailing, never as
  runtime background tasks.
- INTERFACE.md is the stability contract — changes require a semver major bump after
  v0.1.0 and a note to consumers.

## Verification

- After build work: `bash build.sh` clean run + smoke tests in BUILDING.md §Steps 4.
- Before any release tag: acceptance criteria in BUILDING.md §Acceptance criteria
  (all five items).
