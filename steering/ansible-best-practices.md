# Ansible Best Practices – Project Conventions

Project rules + `ansible-lint` violations `lint_file` tool surface. General Ansible concepts:
<https://docs.ansible.com/ansible/latest/>.

## Hard rules in this project

1. **FQCN only** — every module call use `ansible.builtin.<name>` (or
   `<collection>.<name>` non-builtin). Lint: `fqcn[action]`.
2. **Mode is ugo, never octal** — `mode: 'u=rw,g=r,o=r'`, not `'0644'`. `o=`
   mandatory even when others have no permissions (`mode: 'u=rw,g=r,o='`).
3. **Pin versions** — `state: present` + pinned version, never
   `state: latest`. Lint: `package-latest`.
4. **Every task has a name** — uppercase first char. Lint:
   `name[missing]`, `name[casing]`.
5. **`command`/`shell` must use `cmd:` key** — no free-form args. Lint:
   `no-free-form`. Always set `changed_when:` (`false` for read-only).
   Lint: `no-changed-when`.
6. **No implicit type coercion** — use Jinja filters (e.g. `to_json`) when
   passing dicts/lists. Lint: `avoid-implicit`.
7. **Tags everywhere** — every task gets one+ tag for `--tags` filter.
8. **Truthy literals** — `true`/`false` only, never `yes/no/True/False`.
   Lint: `yaml[truthy]`.
9. **Role variable naming** — role vars prefixed with role name.
   Lint: `var-naming[no-role-prefix]`.

## Play skeleton

```yaml
---
- name: Configure web servers
  hosts: webservers
  become: true
  tags: [webservers]

  vars:
    nginx_port: 80
    app_user: webapp

  tasks:
    - name: Install nginx
      ansible.builtin.package:
        name: nginx-1.24.0
        state: present
      tags: [packages]
      notify: Restart nginx

    - name: Copy nginx configuration
      ansible.builtin.template:
        src: nginx.conf.j2
        dest: /etc/nginx/nginx.conf
        owner: root
        group: root
        mode: 'u=rw,g=r,o=r'
      tags: [config]
      notify: Restart nginx

  handlers:
    - name: Restart nginx         # uppercase, matches notify string exactly
      ansible.builtin.service:
        name: nginx
        state: restarted
```

## Idempotency — the critical rule

Every task must produce same outcome 2nd run as 1st. Use module state
semantics (`state: present/absent`) or `creates:`/`removes:` on
`command`/`shell`.

```yaml
# GOOD Idempotent — package module
- name: Install nginx
  ansible.builtin.package: { name: nginx, state: present }

# GOOD Idempotent — creates: marker
- name: Download app archive
  ansible.builtin.command:
    cmd: wget https://example.com/app.tar.gz -O /opt/app.tar.gz
    creates: /opt/app.tar.gz

# BAD Not idempotent — re-downloads every run
- name: Download app archive
  ansible.builtin.command:
    cmd: wget https://example.com/app.tar.gz

# BAD Not idempotent — keeps appending
- name: Append config
  ansible.builtin.shell:
    cmd: echo "config=value" >> /etc/app.conf
```

## Variable precedence

Lowest → highest: role defaults < group_vars < host_vars < play vars < role vars < extra vars (`-e`).
Full spec: <https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_variables.html#understanding-variable-precedence>.

## Error handling

```yaml
# Custom failure condition
- name: Run command
  ansible.builtin.command: { cmd: /usr/bin/mycommand }
  register: result
  failed_when: "'ERROR' in result.stderr"

# Read-only command — never marks changed
- name: Check configuration
  ansible.builtin.command: { cmd: /usr/bin/check_config }
  register: config_check
  changed_when: false

# block / rescue / always
- name: Risky workflow
  block:
    - name: Risky task
      ansible.builtin.command: { cmd: /usr/bin/risky_operation }
  rescue:
    - name: Handle failure
      ansible.builtin.debug: { msg: "Operation failed, running recovery" }
  always:
    - name: Cleanup
      ansible.builtin.debug: { msg: "Cleanup complete" }
```

## Lint anti-patterns

### `no-handler` — use `notify`, not `when: result.changed`

```yaml
# BAD
- ansible.builtin.copy: { src: nginx.conf, dest: /etc/nginx/nginx.conf, mode: 'u=rw,g=r,o=r' }
  register: result
- ansible.builtin.service: { name: nginx, state: restarted }
  when: result.changed

# GOOD
- ansible.builtin.copy: { src: nginx.conf, dest: /etc/nginx/nginx.conf, mode: 'u=rw,g=r,o=r' }
  notify: Restart nginx
```

### `partial-become` — `become_user` requires `become: true` at the same level

```yaml
# GOOD
- ansible.builtin.service: { name: myapp, state: started }
  become: true
  become_user: appuser
```

### `risky-shell-pipe` — `set -o pipefail` when piping in `shell:`

```yaml
- ansible.builtin.shell:
    cmd: |
      set -o pipefail
      cat /etc/hosts | grep localhost
    executable: /bin/bash
  changed_when: false
```

### `no-log-password` — `no_log: true` when looping over secrets

```yaml
- ansible.builtin.user:
    name: "{{ item.name }}"
    password: "{{ item.password }}"
  loop: "{{ users }}"
  no_log: true
```

### `avoid-implicit` — explicit Jinja for non-string values

```yaml
# BAD
- ansible.builtin.copy:
    content: { "key": "value" }
    dest: /tmp/config.json

# GOOD
- vars: { config: { "key": "value" } }
  ansible.builtin.copy:
    content: "{{ config | to_json }}"
    dest: /tmp/config.json
```

### `import-task-no-when` — `when:` on `import_tasks` is evaluated once

Use `include_tasks` when condition depends on runtime state.

### `when:` may only reference facts / registered vars

```yaml
# GOOD
- ansible.builtin.package: { name: nginx, state: present }
  when: ansible_os_family == "Debian"

# GOOD
- ansible.builtin.service: { name: nginx, state: restarted }
  when: config_result.changed

# BAD shell-command-in-when — fragile and not declarative
- ansible.builtin.debug: { msg: "exists" }
  when: "{{ lookup('pipe', 'test -f /etc/nginx/nginx.conf') }}"
```

## Loops

Use `loop:`, never `with_items:`. Always set `loop_control.label` so progress
output stays readable.

```yaml
- name: Create users
  ansible.builtin.user:
    name: "{{ item.name }}"
    groups: "{{ item.groups }}"
    state: present
  loop:
    - { name: alice, groups: admin,developers }
    - { name: bob,   groups: developers }
  loop_control:
    label: "{{ item.name }}"
```

In roles, prefix loop variable to avoid collisions with outer loops
(see `ansible-role-structure.md`).

## Module choice

Prefer `ansible.builtin.*` (copy, template, package, service, command, shell, systemd).
`command`/`shell` only when no dedicated module exists — always `cmd:` + `changed_when:`.
Verify available modules: `ansible-doc -l`.

## Tag strategy

Tags drive `--tags` / `--skip-tags`. Two special tags:

- `always` — runs regardless of `--tags` filter.
- `never` — runs only when explicitly listed in `--tags`.

```yaml
tasks:
  - name: Pre-flight assertions
    ansible.builtin.assert: { that: ["app_user is defined"] }
    tags: [always]

  - name: Install packages
    ansible.builtin.package: { name: nginx, state: present }
    tags: [packages, nginx]

  - name: Destructive test
    ansible.builtin.command: { cmd: /usr/local/bin/test_nginx.sh }
    changed_when: false
    tags: [never, testing]   # only on --tags testing
```

## Async tasks

Long-running operations: use `async:` with `poll: 0`, then `ansible.builtin.async_status` to await.
Full pattern: <https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_async.html>.

## Privilege escalation

```yaml
# Play-wide
- hosts: all
  become: true
  become_method: sudo

# Per-task — both keys at the same level
- name: Start as app user
  ansible.builtin.service: { name: myapp, state: started }
  become: true
  become_user: appuser
```

## Performance

`ansible.cfg`: `forks=20`, `pipelining=True`, `ControlMaster=auto`/`ControlPersist=60s`.
Set `gather_facts: false` on plays that don't need facts.

## Secrets

Never plain text in repo. Use one of:

- `ansible-vault` encrypted strings (see `ansible-vault.md`)
- `lookup('env', 'VAR')`
- `lookup('hashi_vault', 'secret=...')`

## `.ansible-lint` baseline

```yaml
profile: production
offline: true
enable_list: [no-log-password, loop-var-prefix]
loop_var_prefix: "^(__|{role}_)"
var_naming_pattern: "^[a-z_][a-z0-9_]*$"
```

Per-file suppressions → `.ansible-lint-ignore`, not `skip_list`.

## ansible-lint rules

Critical violations → use `lint_file` tool. Key rules covered in sections above:
`name[missing]`, `name[casing]`, `no-changed-when`, `no-free-form`, `fqcn[action]`,
`var-naming[no-role-prefix]`, `yaml[truthy]`, `no-handler`, `partial-become`,
`package-latest`, `risky-shell-pipe`, `avoid-implicit`, `import-task-no-when`.

Full rule list: <https://docs.ansible.com/projects/lint/rules/>

## Validation workflow

MCP tools enforce in order:

1. `syntax_check` — fast structural check
2. `lint_file` — production-profile rules (see above)
3. `diff_check` — dry-run with `--check --diff`

Docs: <https://docs.ansible.com/projects/lint/rules/>
