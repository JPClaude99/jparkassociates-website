#!/usr/bin/env bash
# Prune merged branches from JPClaude99/jparkassociates-website.
#
# Dry run by default — prints a verdict per branch and deletes nothing.
# Re-run with --delete once you are happy with the verdicts.
#
#   ./prune-branches.sh              # show what would happen
#   ./prune-branches.sh --delete     # actually delete the SAFE ones
#
# Requires: git, and the gh CLI authenticated (gh auth status).
#
# WHY gh IS REQUIRED
# This repo's main branch had its history rewritten. Most old branches share no
# common ancestor with main, so `git merge-base --is-ancestor` reports them as
# unmerged even though their pull requests were squash-merged and their content
# is in main. Git alone cannot tell those apart from genuinely unmerged work.
# The only authority on a squash merge is the pull request, so we ask GitHub.

set -euo pipefail

REPO="JPClaude99/jparkassociates-website"
DELETE=false
[[ "${1:-}" == "--delete" ]] && DELETE=true

command -v gh >/dev/null || { echo "gh CLI not found — install it or see the manual list below."; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated. Run: gh auth login"; exit 1; }

git fetch --all --prune --quiet

safe=(); keep=()

for ref in $(git branch -r --format='%(refname:short)' | grep -v HEAD | grep -v '^origin/main$'); do
  branch=${ref#origin/}
  sha=$(git rev-parse "$ref")

  # 1. Ordinary merge: the branch's commits are reachable from main.
  if git merge-base --is-ancestor "$ref" origin/main 2>/dev/null; then
    printf 'SAFE  %-52s merged into main\n' "$branch"
    safe+=("$branch"); continue
  fi

  # 2. Squash merge: a merged PR exists whose head commit is this branch head.
  #    Matching the SHA matters — it proves nothing was pushed after the merge.
  merged_sha=$(gh pr list --repo "$REPO" --head "$branch" --state merged \
                 --json headRefOid --jq '.[0].headRefOid // empty' 2>/dev/null || true)
  if [[ -n "$merged_sha" && "$merged_sha" == "$sha" ]]; then
    printf 'SAFE  %-52s squash-merged, head matches the merged PR\n' "$branch"
    safe+=("$branch"); continue
  fi

  if [[ -n "$merged_sha" ]]; then
    printf 'KEEP  %-52s PR merged at %s but head is now %s — commits pushed after the merge\n' \
           "$branch" "${merged_sha:0:8}" "${sha:0:8}"
  else
    printf 'KEEP  %-52s no merged PR — carries unmerged work\n' "$branch"
  fi
  keep+=("$branch")
done

echo
echo "SAFE to delete: ${#safe[@]}    KEEP: ${#keep[@]}"

if ((${#keep[@]})); then
  echo
  echo "Back these up before you consider deleting them — once no ref points at"
  echo "those commits, GitHub eventually garbage-collects them:"
  echo
  echo "  git bundle create unmerged-branches.bundle \\"
  printf '    %s \\\n' "${keep[@]::${#keep[@]}-1}"
  printf '    %s\n' "${keep[-1]}"
fi

if ! $DELETE; then
  echo
  echo "Dry run. Re-run with --delete to remove the ${#safe[@]} SAFE branches."
  exit 0
fi

((${#safe[@]})) || { echo "Nothing to delete."; exit 0; }

echo
echo "Restore manifest — keep this. Any branch comes back with:"
echo "  git push origin <sha>:refs/heads/<branch>"
for b in "${safe[@]}"; do printf '  %s  %s\n' "$(git rev-parse "origin/$b")" "$b"; done

echo
read -rp "Delete these ${#safe[@]} branches from origin? [y/N] " reply
[[ "$reply" == [yY] ]] || { echo "Aborted."; exit 0; }

git push origin --delete "${safe[@]}"
echo "Done."
