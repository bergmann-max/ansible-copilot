#!/usr/bin/env bash
# ansible-copilot — installer shim for 5 AI coding agents.
#
# One line:
#   curl -fsSL https://raw.githubusercontent.com/bergmann-max/ansible-copilot/main/install.sh | bash
#
# Local clone:
#   bash install.sh [flags]
#
set -euo pipefail

REPO="bergmann-max/ansible-copilot"

# Require Node >=18
if ! command -v node &>/dev/null; then
    echo "ansible-copilot: Node.js (>=18) required. Install from https://nodejs.org" >&2
    exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "ansible-copilot: Node $NODE_MAJOR too old. Need Node >=18. https://nodejs.org" >&2
    exit 1
fi

# Local clone path -- run the installer directly, no npx round-trip
here="$(cd "$(dirname "${BASH_SOURCE[0]:-}")" 2>/dev/null && pwd)" || here=""
if [ -n "$here" ] && [ -f "$here/bin/install.js" ]; then
    exec node "$here/bin/install.js" "$@"
fi

# Curl|bash path -- delegate to npx
if ! command -v npx &>/dev/null; then
    echo "ansible-copilot: npx required (ships with Node >=18). Reinstall Node.js." >&2
    exit 1
fi

exec npx -y "github:$REPO" -- "$@"
