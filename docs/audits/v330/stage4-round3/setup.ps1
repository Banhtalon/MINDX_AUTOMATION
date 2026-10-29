param([Parameter(Mandatory=$true)][string]$AuditRoot)
$ErrorActionPreference = 'Stop'
$env:MINDX_DB_PATH = Join-Path $AuditRoot 'setup.db'
$env:MINDX_RUNNING_CLASSES_PATH = Join-Path $AuditRoot 'running_classes.json'
$env:ALLOWED_LOCAL_DIRS = $AuditRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = (Get-Location).Path
$tempFull = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
$auditFull = [IO.Path]::GetFullPath($AuditRoot).TrimEnd('\') + '\'
if (-not $auditFull.StartsWith($tempFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'Audit root must be below TEMP' }
$evidence = Join-Path $repo 'docs/audits/v330/stage4-round3'
$mirror = Join-Path $AuditRoot 'workspace'
New-Item -ItemType Directory -Path $mirror -Force | Out-Null
# Explicit source/configuration allowlist. Never enumerate or copy the data root.
$trees = @('src', 'scripts', 'data/config', 'docs/audits/v330/stage4', 'docs/audits/v330/stage4-round2')
$files = @('package.json','package-lock.json','tsconfig.json','next-env.d.ts','start-bot.bat','start-bot.command')
$protected = @()
foreach ($tree in $trees) {
  $protected += Get-ChildItem -LiteralPath (Join-Path $repo $tree) -File -Recurse
  $destination = Join-Path $mirror (Split-Path $tree -Parent)
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $repo $tree) -Destination $destination -Recurse
}
foreach ($file in $files) {
  if (Test-Path -LiteralPath (Join-Path $repo $file)) {
    $protected += Get-Item -LiteralPath (Join-Path $repo $file)
    Copy-Item -LiteralPath (Join-Path $repo $file) -Destination (Join-Path $mirror $file)
  }
}
$manifest = @($protected | Sort-Object FullName -Unique | ForEach-Object {
  [ordered]@{path=$_.FullName.Substring($repo.Length + 1).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash; length=$_.Length; lastWriteUtc=$_.LastWriteTimeUtc.ToString('o')}
})
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $evidence 'source-before.json')
New-Item -ItemType Junction -Path (Join-Path $mirror 'node_modules') -Target (Join-Path $repo 'node_modules') | Out-Null
Set-Content -Encoding UTF8 -LiteralPath (Join-Path $evidence 'temp-root.txt') -Value $AuditRoot
Write-Output "Mirror: $mirror; protected files: $($manifest.Count)"
