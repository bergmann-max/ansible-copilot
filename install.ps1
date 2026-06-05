# ansible-copilot — installer shim (Windows / PowerShell).
#
# One line:
#   irm https://raw.githubusercontent.com/bergmann-max/ansible-copilot/main/install.ps1 | iex
#
# Local clone:
#   pwsh install.ps1 [flags]
#
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
)

$ErrorActionPreference = "Stop"
$Repo = "bergmann-max/ansible-copilot"

# Require Node >=18
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error @"
ansible-copilot: Node.js (>=18) required. Install:
  - winget install OpenJS.NodeJS.LTS
  - or download from https://nodejs.org
"@
    exit 1
}

$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 18) {
    Write-Error "ansible-copilot: Node $nodeMajor too old. Need Node >=18. Upgrade: https://nodejs.org"
    exit 1
}

# Local clone path -- run the installer directly, no npx round-trip
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$local = Join-Path $here "bin/install.js"
if (Test-Path $local) {
    & node $local @Args
    exit $LASTEXITCODE
}

# Curl|pwsh path -- delegate to npx
$npx = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npx) {
    Write-Error "ansible-copilot: npx required (ships with Node >=18). Reinstall Node.js."
    exit 1
}

& npx -y "github:$Repo" -- @Args
exit $LASTEXITCODE
