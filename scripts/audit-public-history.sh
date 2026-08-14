#!/bin/sh
# audit-public-history.sh — pre-push audit before publishing or re-publishing
# any ref of this public repo.
#
# Scans every reachable ref (branches + annotated tags) for strings that must
# never appear here: AI-vendor attribution in commit metadata/messages/tag
# objects, and vendor names in tracked file contents at any revision.
#
# Exit codes: 0 = clean, 1 = findings, 2 = environment error.
#
# Optional: EXTRA_PATTERN='foo|bar' extends the forbidden list (used by the
# maintainer's private pre-publication checklist).

set -u
cd "$(git rev-parse --show-toplevel)" || exit 2

PATTERN='claude|anthropic|openai|chatgpt|copilot|co-authored-by'
[ -n "${EXTRA_PATTERN:-}" ] && PATTERN="$PATTERN|$EXTRA_PATTERN"

fail=0

echo "[1/4] commit authors/committers + messages (all refs)"
if git log --all --format='%H%n%an <%ae>%n%cn <%ce>%n%B' | grep -inE "$PATTERN"; then
  echo "FAIL: forbidden string in commit metadata or message"
  fail=1
else
  echo "  ok"
fi

echo "[2/4] annotated tag objects"
tag_hits=0
for t in $(git tag -l); do
  if [ "$(git cat-file -t "$t" 2>/dev/null)" = "tag" ]; then
    if git cat-file tag "$t" | grep -inE "$PATTERN"; then
      tag_hits=1
    fi
  fi
done
if [ "$tag_hits" -ne 0 ]; then
  echo "FAIL: forbidden string in a tag object"
  fail=1
else
  echo "  ok"
fi

echo "[3/4] tracked file contents (all revisions, all refs)"
# Exclude the enforcement tooling itself: .githooks/commit-msg and this
# script must contain the forbidden patterns verbatim in order to detect
# them; matching themselves is a false positive, not a leak. If either file
# is ever renamed or copied, update this exclusion (or the new path will
# fail the audit until reviewed).
hits=$(git grep -inIE "$PATTERN" $(git rev-list --all) -- . \
  ':(exclude).githooks/commit-msg' ':(exclude)scripts/audit-public-history.sh' 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "$hits" | head -50
  echo "FAIL: forbidden string in tracked file contents"
  fail=1
else
  echo "  ok"
fi

echo "[4/4] local commit identity"
name=$(git config user.name || true)
email=$(git config user.email || true)
echo "  user.name  = $name"
echo "  user.email = $email"
case "$email" in
  *@users.noreply.github.com) echo "  ok (noreply identity)" ;;
  *) echo "  WARN: email is not a GitHub noreply address" ;;
esac

echo
if [ "$fail" -ne 0 ]; then
  echo "AUDIT FAILED — do not push until findings are resolved."
  exit 1
fi
echo "AUDIT CLEAN"
exit 0
