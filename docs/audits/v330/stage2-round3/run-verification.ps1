$ErrorActionPreference = 'Stop'
$workspace = (Get-Location).Path
$evidence = Join-Path $workspace 'docs\audits\v330\stage2-round3'
$temporary = Join-Path $workspace ('data\_temp_stage2_round3_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
$oldDb = $env:MINDX_DB_PATH
$oldCache = $env:MINDX_RUNNING_CLASSES_PATH
$checks = @(
    @{ Name='typecheck'; Args=@('tsc','--noEmit','--incremental','false') },
    @{ Name='report-card'; Args=@('tsx','scripts/test-report-card-v330.ts') },
    @{ Name='stage2'; Args=@('tsx','docs/audits/v330/stage2/probe.ts') },
    @{ Name='stage2-round2'; Args=@('tsx','docs/audits/v330/stage2-round2/probe.ts') },
    @{ Name='phase4'; Args=@('tsx','scripts/test-phase4-codex-repros.ts') }
)
$results = @()
try {
    foreach ($check in $checks) {
        $env:MINDX_DB_PATH = Join-Path $temporary ($check.Name + '.db')
        $env:MINDX_RUNNING_CLASSES_PATH = Join-Path $temporary ($check.Name + '-running-classes.json')
        $started = [DateTime]::UtcNow
        $arguments = $check.Args
        $log = Join-Path $evidence ($check.Name + '.log')
        # Use cmd launcher on Windows; all packages already exist locally.
        $ErrorActionPreference = 'Continue'
        & npx.cmd --no-install @arguments *> $log
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        $row = [pscustomobject]@{
            Name=$check.Name; Command=('npx.cmd --no-install ' + ($arguments -join ' '))
            ExitCode=$exitCode; StartedUtc=$started.ToString('o')
            FinishedUtc=[DateTime]::UtcNow.ToString('o')
            MINDX_DB_PATH=$env:MINDX_DB_PATH
            MINDX_RUNNING_CLASSES_PATH=$env:MINDX_RUNNING_CLASSES_PATH
        }
        $results += $row
        $results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $evidence 'commands.json')
        Write-Output ($check.Name + ': exit ' + $exitCode)
        if ($check.Name -eq 'stage2' -or $check.Name -eq 'stage2-round2') {
            Copy-Item -LiteralPath (Join-Path $workspace ('docs\audits\v330\' + $check.Name + '\observations.json')) -Destination (Join-Path $evidence ($check.Name + '-observations.json'))
        }
    }
} finally {
    $env:MINDX_DB_PATH = $oldDb
    $env:MINDX_RUNNING_CLASSES_PATH = $oldCache
}
