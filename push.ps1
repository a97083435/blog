# ============================================================
# push.ps1 - clean git push wrapper
# ------------------------------------------------------------
# Why: In Windows PowerShell 5.1, `git push 2>&1` wraps git's
# stderr progress ("To github.com/... main -> main") into
# NativeCommandError records that pollute $Error, so automation
# (CI / harness that checks exit code or error stream) may falsely
# report [exit code: 1] even though the push succeeded
# ($LASTEXITCODE can even become -1).
#
# Usage (PowerShell 5.1 / 7):
#   .\push.ps1                     # push current branch to origin
#   .\push.ps1 origin main
#   .\push.ps1 --force-with-lease
#
# How: runs git push through cmd /c, merging stderr into cmd's
# own stdout. PowerShell never touches the redirection, so no error
# records are created; cmd passes git's exit code through unchanged
# (0 success / non-zero real failure). stderr content still prints.
# ============================================================

$cmdLine = 'git push'
if ($args.Count -gt 0) {
  $cmdLine += ' ' + ($args -join ' ')
}

cmd /c "$cmdLine 2>&1"
$code = $LASTEXITCODE
$errCount = $Error.Count

Write-Host "`n[push.ps1] exit=$code error-records=$errCount" -ForegroundColor DarkGray
if ($code -ne 0) {
  Write-Host "[push.ps1] push failed (real error, not a stderr false positive)" -ForegroundColor Yellow
}
exit $code