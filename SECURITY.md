# Security Policy

## Supported Versions

Security fixes land on the default branch and ship with the next release. Only the
latest release line is supported.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Reporting a Vulnerability

Please report vulnerabilities **privately** by email to
**xinjiefang@latingreek.org** (maintainer: Xinjie Fang, Classical Cat Digital
Humanities Lab). Do not open a public issue for a security report.

Please include: affected artifact or file, reproduction steps, and impact. You can
expect an acknowledgement within 3 working days. We will coordinate disclosure
with you after a fix is available.

## Scope Notes

- Build artifacts are derivative works of eSpeak NG (GPLv3). Vulnerabilities in
  the upstream synthesizer itself should also be reported to
  [espeak-ng/espeak-ng](https://github.com/espeak-ng/espeak-ng/security).
- Released artifacts ship with `sha256sums.txt`; always verify checksums when
  vendoring.
