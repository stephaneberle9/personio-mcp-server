#!/usr/bin/env pwsh
#Requires -Version 7.0
<#
.SYNOPSIS
    Probe which Personio OAuth scopes (Zugriffsrechte) a credential is entitled to.

.DESCRIPTION
    General debugging tool for Personio API credential / scope mismatches.

    Personio v2 credentials carry a set of OAuth scopes derived from the
    credential's access rights ("Zugriffsrechte" - per-area Read/Write toggles in
    Settings > Integrations > API Credentials). When you request a token WITHOUT a
    scope, Personio assigns "all scopes available to the client"; when you request
    a specific scope, Personio either issues a token (the scope is granted) or
    returns 400 invalid_scope (the scope is NOT granted to this credential, or the
    scope string does not exist - the two are indistinguishable from the response).

    This script requests one token per scope and reports, per scope:
      * 200          -> AVAILABLE     (the credential has this scope)
      * 400/invalid  -> NOT AVAILABLE (not granted to this credential, or unknown
                        scope name)

    So a quick way to see a credential's full scope profile is to run it with the
    default scope list; to test a hypothesis (e.g. "does this credential have
    document access?") pass the candidate scope(s) via -Scope.

    Credentials are loaded from a <Name>.env file under ~/.secrets/personio/, each
    containing:

        PERSONIO_CLIENT_ID=papi-...
        PERSONIO_CLIENT_SECRET=papi-...

.PARAMETER Name
    Selects which ~/.secrets/personio/<Name>.env file to load. If omitted and the
    folder holds exactly one *.env file, that one is used; if it holds several,
    the script lists them and prompts you to pick one by number.

.PARAMETER Scope
    One or more scopes to probe (each requested in its own token call, so a
    credential's per-scope entitlement is revealed individually). Defaults to the
    known Personio v2 scope strings. Scope strings look like
    personio:<area>:read|write (e.g. personio:recruiting:read).

.PARAMETER BaseUrl
    Personio API base URL. Defaults to https://api.personio.de.

.EXAMPLE
    # Show the full scope profile of the only credential present
    ./scripts/check-personio-scopes.ps1

.EXAMPLE
    # Show the scope profile of a specific credential set
    ./scripts/check-personio-scopes.ps1 -Name recruiting

.EXAMPLE
    # Test specific candidate scopes against a credential
    ./scripts/check-personio-scopes.ps1 -Name finance -Scope personio:persons:read,personio:compensations:read

.NOTES
    Requires PowerShell 7+ (uses -SkipHttpErrorCheck / -StatusCodeVariable).
#>
[CmdletBinding()]
param(
    [string]$Name,
    [string[]]$Scope = @(
        'personio:persons:read',
        'personio:persons:write',
        'personio:attendances:read',
        'personio:attendances:write',
        'personio:absences:read',
        'personio:compensations:read',
        'personio:compensations:write',
        'personio:recruiting:read',
        'personio:jobs:read',
        'personio:salary-bands:read',
        'personio:webhooks:read',
        'personio:webhooks:write'
    ),
    [string]$BaseUrl = 'https://api.personio.de'
)

$ErrorActionPreference = 'Stop'

$secretsDir = Join-Path $HOME '.secrets/personio'

if (-not (Test-Path -LiteralPath $secretsDir)) {
    Write-Error "Secrets directory not found: $secretsDir"
    exit 1
}

# Resolve which <Name>.env file to load.
if ($Name) {
    $envFile = Join-Path $secretsDir "$Name.env"
    if (-not (Test-Path -LiteralPath $envFile)) {
        Write-Error "Env file not found: $envFile"
        exit 1
    }
}
else {
    $candidates = @(Get-ChildItem -LiteralPath $secretsDir -Filter '*.env' -File)
    if ($candidates.Count -eq 0) {
        Write-Error "No *.env files found in $secretsDir. Create one (e.g. acme.env) with PERSONIO_CLIENT_ID / PERSONIO_CLIENT_SECRET."
        exit 1
    }
    if ($candidates.Count -eq 1) {
        $envFile = $candidates[0].FullName
    }
    else {
        Write-Host "Multiple credential sets found in ${secretsDir}:" -ForegroundColor Yellow
        for ($i = 0; $i -lt $candidates.Count; $i++) {
            Write-Host ("  [{0}] {1}" -f ($i + 1), $candidates[$i].BaseName)
        }

        $selection = $null
        while ($null -eq $selection) {
            $answer = Read-Host "Select a credential set by number (1-$($candidates.Count)), or Q to quit"
            if ($answer -match '^[Qq]$') {
                Write-Host 'Aborted.' -ForegroundColor DarkGray
                exit 1
            }
            if ($answer -match '^\d+$') {
                $n = [int]$answer
                if ($n -ge 1 -and $n -le $candidates.Count) {
                    $selection = $candidates[$n - 1]
                    break
                }
            }
            Write-Host "Please enter a number between 1 and $($candidates.Count)." -ForegroundColor Red
        }
        $envFile = $selection.FullName
    }
}

# Parse the .env file: KEY=VALUE lines, ignoring blanks, comments, and optional
# surrounding quotes. Splits on the first '=' only so secrets may contain '='.
$creds = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
    $trimmed = $line.Trim()
    if ($trimmed -eq '' -or $trimmed.StartsWith('#')) { continue }

    $idx = $trimmed.IndexOf('=')
    if ($idx -lt 1) { continue }

    $key   = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim().Trim('"', "'")
    $creds[$key] = $value
}

$clientId     = $creds['PERSONIO_CLIENT_ID']
$clientSecret = $creds['PERSONIO_CLIENT_SECRET']

if ([string]::IsNullOrWhiteSpace($clientId) -or [string]::IsNullOrWhiteSpace($clientSecret)) {
    Write-Error "PERSONIO_CLIENT_ID and PERSONIO_CLIENT_SECRET must both be set in $envFile."
    exit 1
}

Write-Host "Loaded credentials from: $envFile" -ForegroundColor DarkGray

# Probe each scope in its own token request. Personio grants "all scopes
# available to the client" when none is requested, so asking for one scope at a
# time reveals whether THAT scope is among the credential's entitlements:
#   200            -> the scope is available to this credential
#   400/invalid    -> the scope is not available (or the scope name is wrong;
#                     the response body disambiguates)
$results = foreach ($s in $Scope) {
    $body = @{
        grant_type    = 'client_credentials'
        client_id     = $clientId
        client_secret = $clientSecret
        scope         = $s
    }

    $resp = Invoke-RestMethod -Method Post `
        -Uri "$BaseUrl/v2/auth/token" `
        -ContentType 'application/x-www-form-urlencoded' `
        -Body $body `
        -SkipHttpErrorCheck `
        -StatusCodeVariable status

    if ($status -eq 200) {
        Write-Host ("  {0,-42} {1}  AVAILABLE" -f $s, $status) -ForegroundColor Green
        [pscustomobject]@{ Scope = $s; Status = $status; Available = $true }
    }
    else {
        $detail = if ($resp -is [string]) { $resp } else { $resp | ConvertTo-Json -Depth 5 -Compress }
        Write-Host ("  {0,-42} {1}  NOT AVAILABLE" -f $s, $status) -ForegroundColor Yellow
        Write-Verbose ("       {0}" -f $detail)
        [pscustomobject]@{ Scope = $s; Status = $status; Available = $false }
    }
}

Write-Host ''
Write-Host 'Scopes available to this credential:' -ForegroundColor Cyan
$granted = $results | Where-Object Available
if ($granted) { $granted.Scope | ForEach-Object { Write-Host "  $_" -ForegroundColor Green } }
else { Write-Host '  (none of the probed scopes are available)' -ForegroundColor DarkGray }

# Exit non-zero only if NOTHING was available (likely a credential/connectivity
# problem); a partial profile is a normal, successful probe. Re-run with
# -Verbose to see the invalid_scope response bodies.
if ($granted) { exit 0 } else { exit 1 }
