# ansible-copilot

![OpenCode](https://img.shields.io/badge/OpenCode-black?style=for-the-badge)
![Claude Code](https://img.shields.io/badge/Claude_Code-D97757?style=for-the-badge)
![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-4285F4?style=for-the-badge)
![Supports OpenAI Codex](https://img.shields.io/badge/OpenAI_Codex-10A37F?style=for-the-badge)
![Supports GitHub Copilot](https://img.shields.io/badge/GitHub_Copilot-8957E5?style=for-the-badge)

## About

Ansible plugin for AI coding agents. MCP server + 8 steering files to build, lint, and validate Ansible playbooks and roles with best practices.

Supports **OpenCode**, **Claude Code**, **Gemini CLI**, **OpenAI Codex**, and **GitHub Copilot**.

## Install

One line. Auto-detects agents. Installs for each.

```bash
# macOS / Linux / WSL
curl -fsSL https://raw.githubusercontent.com/bergmann-max/ansible-copilot/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/bergmann-max/ansible-copilot/main/install.ps1 | iex
```

Needs [`uv`](https://docs.astral.sh/uv/) + Python 3.12+. Dependencies resolved automatically by `uvx`. Safe to re-run. Use `--dry-run` to preview, `--force` to reinstall.

| Agent | Install command |
|-------|----------------|
| **OpenCode** | `node bin/install.js --only opencode` |
| **Claude Code** | `claude plugin install ansible-copilot@ansible-copilot` |
| **Gemini CLI** | `gemini extensions install https://github.com/bergmann-max/ansible-copilot` |
| **OpenAI Codex** | `node bin/install.js --only codex --with-init` |
| **GitHub Copilot** | `node bin/install.js --only copilot --with-init` |

Via npx:

```bash
npx -y github:bergmann-max/ansible-copilot -- --only opencode
npx -y github:bergmann-max/ansible-copilot -- --only codex --with-init
npx -y github:bergmann-max/ansible-copilot -- --only copilot --with-init
```

All flags (`--dry-run`, `--force`, `--uninstall`, `--list`, `--with-init`, `--minimal`, `--no-mcp-server`) work via curl, node, and npx.

## What You Get

| Tool | What |
|------|------|
| `lint_file` | ansible-lint on file or role directory |
| `syntax_check` | Validate playbook, no execution |
| `diff_check` | Preview changes via `--check --diff` |
| `gather_facts` | Collect facts from host or group |
| `list_hosts` | Hosts affected by playbook |
| `list_tags` | Tags defined in playbook |

## Steering

8 files. Loaded on demand per task. Teach the agent:

- **Best practices** — idempotency, YAML style, FQCN, naming
- **Role structure** — layout, task organization, handlers, defaults
- **Playbook workflow** — creation, execution, play structure
- **Jinja2** — filters, tests, lookups, `when:`
- **Inventory** — structure, group_vars, host_vars, dynamic
- **ansible.cfg** — defaults, SSH, privilege escalation, callbacks
- **Vault** — secrets management, encryption patterns
- **Collections** — Galaxy, requirements.yml, namespaces

## Activation

Activation: keyword auto-detection (`ansible`, `playbook`, `role`, `handler`, `inventory`, `vault`) or `/ansible-copilot` slash command (OpenCode, Claude Code, Gemini CLI, OpenAI Codex).

## Links

- [ANSIBLE.md](ANSIBLE.md) — workflows, tool reference, troubleshooting
- [Issues](https://github.com/bergmann-max/ansible-copilot/issues)

## License

MIT

## Author

Max Bergmann
