param([Parameter(Mandatory=$true)][string]$AuditRoot)
$ErrorActionPreference = 'Stop'
$env:MINDX_DB_PATH = Join-Path $AuditRoot 'verification.db'
$env:MINDX_RUNNING_CLASSES_PATH = Join-Path $AuditRoot 'verification-classes.json'
$env:ALLOWED_LOCAL_DIRS = $AuditRoot
$repo = (Get-Location).Path
$evidence = Join-Path $repo 'docs/audits/v330/stage4-round3'
$before = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $evidence 'source-before.json') | ConvertFrom-Json
$results = @($before | ForEach-Object {
  # Manifest comes from setup's explicit source/config allowlist, not data root.
  if ($_.path -notmatch '^(src/|scripts/|data/config/|docs/audits/v330/stage4/|docs/audits/v330/stage4-round2/|package(-lock)?\.json$|tsconfig\.json$|next-env\.d\.ts$|start-bot\.(bat|command)$)') { throw 'Unexpected manifest path' }
  $file = Get-Item -LiteralPath (Join-Path $repo $_.path)
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  [ordered]@{path=$_.path; unchanged=($hash -eq $_.sha256 -and $file.Length -eq $_.length -and $file.LastWriteTimeUtc.ToString('o') -eq $_.lastWriteUtc)}
})
$failed = @($results | Where-Object {-not $_.unchanged})
[ordered]@{protectedFiles=$results.Count; unchanged=$results.Count-$failed.Count; changed=$failed.Count; productionData='Explicitly excluded: never opened, hashed, copied or compared'; results=$results} |
  ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $evidence 'source-verification.json')
Write-Output "Protected files unchanged: $($results.Count-$failed.Count)/$($results.Count)"
if ($failed.Count) { $failed | ConvertTo-Json; exit 1 }
