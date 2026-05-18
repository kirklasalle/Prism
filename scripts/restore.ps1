# scripts/restore.ps1 — PRISM workspace restore (Windows / PowerShell).
#
# Usage:
#   pwsh scripts/restore.ps1 <archive> [<workspace>] [-Force]
#
# If <workspace> is omitted, resolves PRISM_WORKSPACE_ROOT or
# $HOME\Prism_Refraction. Refuses to overwrite a non-empty existing
# workspace unless -Force is passed.
#
# Exit codes:
#   0 — success
#   2 — archive not found
#   3 — refused to overwrite (re-run with -Force)
#   4 — extract failure

[CmdletBinding()]
param(
    [Parameter(Position = 0, Mandatory = $true)] [string] $Archive,
    [Parameter(Position = 1)] [string] $Workspace,
    [switch] $Force
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) {
    Write-Error "[restore] archive not found: $Archive"
    exit 2
}

if (-not $Workspace) {
    if ($env:PRISM_WORKSPACE_ROOT) { $Workspace = $env:PRISM_WORKSPACE_ROOT }
    else { $Workspace = Join-Path $HOME 'Prism_Refraction' }
}

if (Test-Path -LiteralPath $Workspace -PathType Container) {
    $entries = Get-ChildItem -LiteralPath $Workspace -Force
    if ($entries.Count -gt 0 -and -not $Force) {
        Write-Host "[restore] workspace not empty: $Workspace"
        Write-Host "[restore] re-run with -Force to overwrite. Refusing."
        exit 3
    }
}
else {
    New-Item -ItemType Directory -Path $Workspace -Force | Out-Null
}

Write-Host "[restore] archive   : $Archive"
Write-Host "[restore] workspace : $Workspace"

try {
    Expand-Archive -LiteralPath $Archive -DestinationPath $Workspace -Force
}
catch {
    Write-Error "[restore] failed: $($_.Exception.Message)"
    exit 4
}

Write-Host "[restore] OK"
exit 0
