$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$evidence = $PSScriptRoot
$clone = [IO.Path]::GetFullPath((Join-Path $env:TEMP 'mindx-round40-phase7'))
$expectedClone = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'mindx-round40-phase7'))
if ($clone -ne $expectedClone -or (Test-Path -LiteralPath $clone)) { throw 'TEMP target unexpected or already exists; refuse overwrite.' }
$expectedHash = 'B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000'
if ((Get-FileHash (Join-Path $repo 'next-env.d.ts')).Hash -ne $expectedHash) { throw 'next-env.d.ts hash mismatch' }
$rootFiles = @('package.json','tsconfig.json','next.config.ts','next-env.d.ts','start-bot.bat','start-bot.command')
function Get-ProtectedManifest {
  $paths = @($rootFiles | ForEach-Object { Get-Item -LiteralPath (Join-Path $repo $_) })
  foreach ($dir in @('src','scripts','data/config')) { $paths += @(Get-ChildItem -LiteralPath (Join-Path $repo $dir) -File -Recurse) }
  foreach ($round in 12..40) {
    $dir = Join-Path $repo "docs/audits/round-$round"
    if (Test-Path -LiteralPath $dir) { $paths += @(Get-ChildItem -LiteralPath $dir -File -Recurse) }
  }
  @($paths | Sort-Object FullName -Unique | ForEach-Object {
    [ordered]@{ path = $_.FullName.Substring($repo.Length + 1).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
  })
}
$before = @(Get-ProtectedManifest)
$before | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidence 'integrity-before.json') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $repo 'MINDX_AUTOMATION_PLAN.md') -Destination (Join-Path $evidence 'plan-before.md')
git -C $repo status --short | Set-Content -LiteralPath (Join-Path $evidence 'git-status-before.txt') -Encoding UTF8
$head = (git -C $repo rev-parse HEAD).Trim()
$gates = @()
$copyIntegrity = $null
$started = [DateTime]::UtcNow.ToString('o')
try {
  New-Item -ItemType Directory -Path $clone | Out-Null
  foreach ($file in ($rootFiles + @('MINDX_AUTOMATION_PLAN.md'))) { Copy-Item -LiteralPath (Join-Path $repo $file) -Destination $clone }
  foreach ($dir in @('src','scripts','docs')) { Copy-Item -LiteralPath (Join-Path $repo $dir) -Destination $clone -Recurse }
  New-Item -ItemType Directory -Path (Join-Path $clone 'data') | Out-Null
  Copy-Item -LiteralPath (Join-Path $repo 'data/config') -Destination (Join-Path $clone 'data') -Recurse
  New-Item -ItemType Junction -Path (Join-Path $clone 'node_modules') -Target (Join-Path $repo 'node_modules') | Out-Null
  $copyDifferences = @($before | Where-Object { (Get-FileHash -LiteralPath (Join-Path $clone $_.path) -Algorithm SHA256).Hash -ne $_.sha256 })
  $copyIntegrity = @{ checkedBeforeGates=$true; filesCompared=$before.Count; differences=$copyDifferences; identical=($copyDifferences.Count -eq 0) }
  if ($copyDifferences.Count -ne 0) { throw 'TEMP copy differs from protected working-tree snapshot' }
  $definitions = @(
    @{ id='adversarial'; args=@('--import','tsx','docs/audits/round-40/adversarial.mjs') },
    @{ id='phase7'; args=@('node_modules/tsx/dist/cli.mjs','scripts/test-phase7.ts') },
    @{ id='phase6'; args=@('node_modules/tsx/dist/cli.mjs','scripts/test-phase6.ts') },
    @{ id='phase5'; args=@('node_modules/tsx/dist/cli.mjs','scripts/test-phase5.ts') },
    @{ id='tsc'; args=@('node_modules/typescript/bin/tsc','--noEmit','--incremental','false') }
  )
  foreach ($gate in $definitions) {
    $si = New-Object System.Diagnostics.ProcessStartInfo
    $si.FileName = (Get-Command node).Source
    $si.Arguments = $gate.args -join ' '
    $si.WorkingDirectory = $clone
    $si.UseShellExecute = $false
    $si.CreateNoWindow = $true
    $si.RedirectStandardOutput = $true
    $si.RedirectStandardError = $true
    foreach ($key in @('TEACHING_PASSWORD','LMS_PASSWORD','GEMINI_API_KEY','MINDX_PASSWORD','TEACHING_USERNAME','LMS_USERNAME','MINDX_USERNAME','ALLOWED_LOCAL_DIRS','NODE_OPTIONS')) { $si.EnvironmentVariables.Remove($key) }
    $si.EnvironmentVariables['ESBUILD_BINARY_PATH'] = Join-Path $env:TEMP 'mindx-esbuild.exe'
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $si
    $gateStarted = [DateTime]::UtcNow
    [void]$p.Start()
    $stdout = $p.StandardOutput.ReadToEndAsync()
    $stderr = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    $outText = $stdout.GetAwaiter().GetResult()
    $errText = $stderr.GetAwaiter().GetResult()
    [IO.File]::WriteAllText((Join-Path $evidence ($gate.id + '.log')), $outText + $errText, (New-Object Text.UTF8Encoding($false)))
    $gates += [ordered]@{ id=$gate.id; command=('node ' + $si.Arguments); exitCode=$p.ExitCode; startedAt=$gateStarted.ToString('o'); durationMs=[Math]::Round(([DateTime]::UtcNow-$gateStarted).TotalMilliseconds); log=($gate.id+'.log') }
    Write-Output ($gate.id + ': exit ' + $p.ExitCode)
    $p.Dispose()
  }
  $r40Evidence = Join-Path $clone 'docs/audits/round-40/evidence'
  foreach ($file in @('adversarial-results.json','launcher-install-block.log','client-inputs.json','ui-syllabus.png')) {
    if (Test-Path -LiteralPath (Join-Path $r40Evidence $file)) { Copy-Item -LiteralPath (Join-Path $r40Evidence $file) -Destination (Join-Path $evidence $file) }
  }
} finally {
  if (Test-Path -LiteralPath $clone) {
    $resolvedClone = (Resolve-Path -LiteralPath $clone).Path
    if ($resolvedClone -ne $expectedClone -or ((Get-Item -LiteralPath $clone).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refuse unsafe TEMP deletion' }
    $junction = Join-Path $clone 'node_modules'
    if (Test-Path -LiteralPath $junction) {
      if (-not ((Get-Item -LiteralPath $junction).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected node_modules junction' }
      [IO.Directory]::Delete($junction)
    }
    Remove-Item -LiteralPath $resolvedClone -Recurse -Force
  }
  $after = @(Get-ProtectedManifest)
  $after | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidence 'integrity-after.json') -Encoding UTF8
  $changed = @(Compare-Object ($before | ForEach-Object { $_.path + ':' + $_.sha256 }) ($after | ForEach-Object { $_.path + ':' + $_.sha256 }))
  [ordered]@{ audit='AUDIT-R41'; head=$head; startedAt=$started; completedAt=[DateTime]::UtcNow.ToString('o'); clone=$clone; copyIntegrity=$copyIntegrity; gates=$gates; integrity=@{ beforeCount=$before.Count; afterCount=$after.Count; differences=$changed; unchanged=($changed.Count -eq 0); nextEnvSha256=(Get-FileHash (Join-Path $repo 'next-env.d.ts')).Hash }; cleanup=@{ cloneRemoved=(-not (Test-Path -LiteralPath $clone)); nodeModulesPreserved=(Test-Path -LiteralPath (Join-Path $repo 'node_modules/tsx/dist/cli.mjs')) } } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $evidence 'gates.json') -Encoding UTF8
}
