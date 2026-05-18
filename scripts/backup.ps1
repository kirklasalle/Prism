# scripts/backup.ps1 — PRISM workspace backup (Windows / PowerShell).
#
# Resolves the workspace via:
#   1. argument         — `pwsh scripts/backup.ps1 <workspace> [<archive>]`
#   2. PRISM_WORKSPACE_ROOT env var
#   3. fallback         — $HOME\Prism_Refraction
#
# Produces a timestamped .zip archive (Compress-Archive is shipped with
# Windows PowerShell 5.1 and PowerShell 7+, so no extra tooling is needed).
#
# Exit codes:
#   0 — success
#   2 — workspace path is missing or not a directory
#   3 — archive write failure

[CmdletBinding()]
param(
    [Parameter(Position = 0)] [string] $Workspace,
    [Parameter(Position = 1)] [string] $Output
)

$ErrorActionPreference = 'Stop'

if (-not $Workspace) {
    if ($env:PRISM_WORKSPACE_ROOT) { $Workspace = $env:PRISM_WORKSPACE_ROOT }
    else { $Workspace = Join-Path $HOME 'Prism_Refraction' }
}

if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) {
    Write-Error "[backup] workspace not found: $Workspace"
    exit 2
}

$stamp = (Get-Date -AsUTC).ToString('yyyyMMddTHHmmssZ')
if (-not $Output) {
    $Output = Join-Path (Get-Location) "prism-backup-$stamp.zip"
}

Write-Host "[backup] workspace : $Workspace"
Write-Host "[backup] archive   : $Output"

try {
    # -Force lets the operator overwrite an existing archive intentionally.
    Compress-Archive -Path (Join-Path $Workspace '*') -DestinationPath $Output -Force
}
catch {
    Write-Error "[backup] failed: $($_.Exception.Message)"
    exit 3
}

$size = (Get-Item -LiteralPath $Output).Length
Write-Host "[backup] OK ($([Math]::Round($size / 1MB, 2)) MiB)"
exit 0
