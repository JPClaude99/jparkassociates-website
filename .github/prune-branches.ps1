<#
.SYNOPSIS
  Prune merged branches from JPClaude99/jparkassociates-website.

.DESCRIPTION
  Dry run by default — prints a verdict per branch and deletes nothing.
  Re-run with -Delete once you are happy with the verdicts.

  WHY gh IS REQUIRED
  This repo's main branch had its history rewritten. Most old branches share no
  common ancestor with main, so `git merge-base --is-ancestor` reports them as
  unmerged even though their pull requests were squash-merged and their content
  is in main. Git alone cannot tell those apart from genuinely unmerged work.
  The only authority on a squash merge is the pull request, so we ask GitHub.

.EXAMPLE
  .\.github\prune-branches.ps1
  .\.github\prune-branches.ps1 -Delete
#>
[CmdletBinding()]
param([switch]$Delete)

$ErrorActionPreference = 'Stop'

# PowerShell 7.3+ can turn a non-zero exit code from a native command into a
# terminating error. This script reads $LASTEXITCODE deliberately -- notably
# `git merge-base --is-ancestor`, whose whole job is to answer with exit 1 --
# so opt out where that preference exists. Windows PowerShell 5.1 has no such
# variable and never throws on native exit codes, hence the guard.
if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$Repo = 'JPClaude99/jparkassociates-website'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "gh CLI not found. Install from https://cli.github.com/" -ForegroundColor Red; exit 1
}
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "gh is not authenticated. Run: gh auth login" -ForegroundColor Red; exit 1 }

git fetch --all --prune --quiet

$safe = @(); $keep = @()

$refs = git branch -r --format='%(refname:short)' |
        Where-Object { $_ -notmatch 'HEAD' -and $_ -ne 'origin/main' }

foreach ($ref in $refs) {
  $branch = $ref -replace '^origin/', ''
  $sha    = (git rev-parse $ref).Trim()

  # 1. Ordinary merge: the branch's commits are reachable from main.
  git merge-base --is-ancestor $ref origin/main 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host ("SAFE  {0,-52} merged into main" -f $branch) -ForegroundColor Green
    $safe += $branch; continue
  }

  # 2. Squash merge: a merged PR exists whose head commit is this branch head.
  #    Matching the SHA matters — it proves nothing was pushed after the merge.
  $mergedSha = (gh pr list --repo $Repo --head $branch --state merged `
                  --json headRefOid --jq '.[0].headRefOid // empty' 2>$null | Out-String).Trim()

  if ($mergedSha -and $mergedSha -eq $sha) {
    Write-Host ("SAFE  {0,-52} squash-merged, head matches the merged PR" -f $branch) -ForegroundColor Green
    $safe += $branch; continue
  }

  if ($mergedSha) {
    Write-Host ("KEEP  {0,-52} PR merged at {1} but head is now {2} - commits pushed after the merge" -f `
                $branch, $mergedSha.Substring(0,8), $sha.Substring(0,8)) -ForegroundColor Yellow
  } else {
    Write-Host ("KEEP  {0,-52} no merged PR - carries unmerged work" -f $branch) -ForegroundColor Yellow
  }
  $keep += $branch
}

Write-Host ""
Write-Host ("SAFE to delete: {0}    KEEP: {1}" -f $safe.Count, $keep.Count)

if ($keep.Count) {
  Write-Host ""
  Write-Host "Back these up before you consider deleting them - once no ref points at"
  Write-Host "those commits, GitHub eventually garbage-collects them:"
  Write-Host ""
  Write-Host ("  git bundle create unmerged-branches.bundle " + ($keep -join ' '))
}

if (-not $Delete) {
  Write-Host ""
  Write-Host ("Dry run. Re-run with -Delete to remove the {0} SAFE branches." -f $safe.Count)
  exit 0
}

if (-not $safe.Count) { Write-Host "Nothing to delete."; exit 0 }

Write-Host ""
Write-Host "Restore manifest - keep this. Any branch comes back with:"
Write-Host "  git push origin <sha>:refs/heads/<branch>"
foreach ($b in $safe) { Write-Host ("  {0}  {1}" -f (git rev-parse "origin/$b").Trim(), $b) }

Write-Host ""
$reply = Read-Host ("Delete these {0} branches from origin? [y/N]" -f $safe.Count)
if ($reply -ne 'y' -and $reply -ne 'Y') { Write-Host "Aborted."; exit 0 }

git push origin --delete $safe
Write-Host "Done." -ForegroundColor Green
