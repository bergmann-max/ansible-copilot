# Ansible Configuration (`ansible.cfg`) – Project Conventions

Project `ansible.cfg` patterns. Full ref:
<https://docs.ansible.com/ansible/latest/reference_appendices/config.html>.

## Resolution order

Ansible search order, uses **first** found:

1. `ANSIBLE_CONFIG` env var
2. `./ansible.cfg` in CWD
3. `~/.ansible.cfg`
4. `/etc/ansible/ansible.cfg`

Always commit project-local `ansible.cfg` at repo root. No global config reliance — playbooks must behave same on any dev machine and CI.

## Minimum recommended config

```ini
# ansible.cfg
[defaults]
inventory            = inventory/hosts.yml
roles_path           = roles:~/.ansible/roles
collections_path     = collections:~/.ansible/collections
host_key_checking    = False
forks                = 20
timeout              = 30
gathering            = smart
fact_caching         = jsonfile
fact_caching_connection = .ansible/facts
fact_caching_timeout = 7200
stdout_callback      = yaml
callbacks_enabled    = profile_tasks, timer
retry_files_enabled  = False
interpreter_python   = auto_silent

[ssh_connection]
pipelining           = True
ssh_args             = -o ControlMaster=auto -o ControlPersist=60s -o PreferredAuthentications=publickey
control_path         = %(directory)s/%%h-%%r

[privilege_escalation]
become               = True
become_method        = sudo
become_user          = root
become_ask_pass      = False
```

## Section reference (project conventions)

### `[defaults]`

| Key | Project value | Why |
|-----|--------------|-----|
| `inventory` | `inventory/hosts.yml` or `inventory/` | See `ansible-inventory.md` |
| `roles_path` | `roles:~/.ansible/roles` | Local roles first, then Galaxy |
| `collections_path` | `collections:~/.ansible/collections` | Same pattern |
| `host_key_checking` | `False` | CI-safe; managed by SSH known_hosts elsewhere |
| `forks` | `20` | Sane default; raise for large fleets |
| `gathering` | `smart` | Skip facts when cached |
| `fact_caching` | `jsonfile` | Faster reruns; cache dir under `.ansible/` |
| `stdout_callback` | `yaml` | Readable diffs and task output |
| `callbacks_enabled` | `profile_tasks, timer` | Surface slow tasks in dev |
| `retry_files_enabled` | `False` | No `.retry` clutter |
| `interpreter_python` | `auto_silent` | Suppress interpreter discovery warnings |

### `[ssh_connection]`

| Key | Project value | Why |
|-----|--------------|-----|
| `pipelining` | `True` | ~30% faster module exec; needs no `requiretty` in sudoers |
| `ssh_args` | `ControlMaster=auto`, `ControlPersist=60s` | Connection multiplexing |
| `control_path` | `%(directory)s/%%h-%%r` | Avoid path-too-long on long FQDNs |

### `[privilege_escalation]`

Always declare even if defaults match — explicit beats implicit. Never set `become_ask_pass = True` in committed config; use `--ask-become-pass` on CLI or vault for sudo passwords.

### `[inventory]` (plugins)

Enable plugins for dynamic inventory:

```ini
[inventory]
enable_plugins = host_list, script, auto, yaml, ini, toml, amazon.aws.aws_ec2
```

See `ansible-inventory.md` for full dynamic-inventory pattern.

## Per-environment config

Do **not** ship multiple `ansible.cfg` files. Override via env var:

```bash
ANSIBLE_CONFIG=ansible.prod.cfg ansible-playbook playbooks/site.yml
```

Or directory-scoped CWD: each env gets own subdir with own `ansible.cfg`. Prefer env var for CI.

## Vault integration

```ini
[defaults]
vault_password_file = .vault_pass        # gitignored
# or for multiple vault IDs:
vault_identity_list = dev@.vault_pass_dev, prod@.vault_pass_prod
```

See `ansible-vault.md` for vault password-file management.

## Anti-patterns

- `host_key_checking = True` without provisioning `known_hosts` first → first run fails on every new host. Disabling (`ANSIBLE_HOST_KEY_CHECKING=False`) may be acceptable in CI pipelines, ephemeral runners, or container tests where MITM risk bounded — user decides on network trust model.
- `forks = 100+` without bumping `ulimit -n` and SSH `MaxSessions`.
- `pipelining = True` where sudoers enforces `requiretty` — task fails with "sudo: sorry, you must have a tty".
- Committing `vault_password_file` content. Path goes in cfg; file itself gitignored.
- Mixing `roles_path` styles across team — pin in `ansible.cfg`, no reliance on `ANSIBLE_ROLES_PATH` env.

## Validation

`ansible-config dump --only-changed` shows every value differing from defaults — use to audit project config drift.
