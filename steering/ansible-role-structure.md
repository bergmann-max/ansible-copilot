# Ansible Role Structure – Project Conventions

Lint rules + general module guidance: see `ansible-best-practices.md`.
Full role layout spec:
<https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html>.

## Required directory layout

```text
roles/<role_name>/
├── tasks/
│   ├── main.yml          # entry point — include_tasks the others
│   ├── install.yml
│   ├── configure.yml
│   ├── debian.yml        # optional OS-specific
│   └── redhat.yml
├── handlers/main.yml
├── defaults/main.yml     # overridable, every var commented
├── vars/main.yml         # internal, not meant to be overridden
├── templates/*.j2
├── files/*
├── meta/main.yml
└── README.md
```

## `tasks/main.yml` skeleton

```yaml
---
- name: Include OS-specific variables
  ansible.builtin.include_vars: "{{ ansible_os_family | lower }}.yml"
  when: ansible_os_family is defined
  tags: always

- name: Install {{ role_name }}
  ansible.builtin.include_tasks: install.yml
  tags: install

- name: Configure {{ role_name }}
  ansible.builtin.include_tasks: configure.yml
  tags: configure
```

## `import_tasks` vs `include_tasks`

| | `import_tasks` | `include_tasks` |
|---|---|---|
| Resolved | parse time (static) | runtime (dynamic) |
| `when:` on directive | evaluated **once** — lint flags `import-task-no-when` | evaluated per-call |
| Tags visible to `--list-tags` | yes | no |
| Use for | unconditional static includes | conditional / OS-specific loading |

```yaml
# GOOD include_tasks for conditional / per-host dynamic loading
- name: Include OS-specific tasks
  ansible.builtin.include_tasks: "{{ ansible_os_family | lower }}.yml"
  when: ansible_os_family is defined

# GOOD import_tasks for unconditional static includes — tags work correctly
- name: Import hardening tasks
  ansible.builtin.import_tasks: hardening.yml

# BAD import-task-no-when — when: applies only at parse time
- name: Import tasks conditionally
  ansible.builtin.import_tasks: optional.yml
  when: some_condition   # <- use include_tasks instead
```

## `changed_when` patterns

```yaml
# Read-only — never marks changed
- name: Check app version
  ansible.builtin.command: { cmd: /usr/bin/myapp --version }
  register: app_version
  changed_when: false

# Explicit condition based on result
- name: Run migration
  ansible.builtin.command: { cmd: /usr/bin/migrate }
  register: migration
  changed_when: "'applied' in migration.stdout"
  failed_when: migration.rc not in [0, 2]   # 2 = no-op
```

## Variable naming — role prefix is mandatory

ansible-lint `var-naming[no-role-prefix]` requires every role variable start with role name. No generic names (`port`, `enabled`, `package`).

```yaml
# Role: install_nginx
install_nginx_port: 80
install_nginx_conf_dir: /etc/nginx
install_nginx_vhosts: []
```

## Loop variables — prefix `__` or `<role>_`

`item` collides in nested loops. Set `loop_control.loop_var` to prefixed name. `.ansible-lint` pattern: `loop_var_prefix: "^(__|{role}_)"`.

```yaml
- name: Create vhosts
  ansible.builtin.template:
    src: vhost.conf.j2
    dest: "/etc/nginx/conf.d/{{ __nginx_vhost.name }}.conf"
    mode: 'u=rw,g=r,o=r'
  loop: "{{ nginx_vhosts }}"
  loop_control:
    loop_var: __nginx_vhost
    label: "{{ __nginx_vhost.name }}"
```

## `defaults/main.yml` — comment every variable

Every var: short comment, role prefix, sensible default. List-typed vars get commented example below empty default — shape visible.

```yaml
---
# Whether the role is active
my_role_enabled: true

# Package to install (pin version)
my_role_package: nginx-1.24.0

# Listening port
my_role_port: 80

# Configuration directory
my_role_conf_dir: /etc/nginx

# List of vhosts
my_role_vhosts: []
# my_role_vhosts:
#   - { name: example.com, port: 80, root: /var/www/example }
```

## `vars/main.yml` — internal only

```yaml
---
# Role: my_role
# Internal values that callers SHOULD NOT override.
my_role__pkg_lookup:
  Debian: nginx
  RedHat: nginx
my_role__service_name: nginx
```

Double-underscore prefix signals "internal".

## Jinja2 template header

Every `.j2` starts with:

```jinja
{# Managed by Ansible – role: {{ role_name }} #}
{# Manual changes will be overwritten on the next Ansible run! #}
```

## Handlers

Use `listen:` — multiple notifiers trigger same handler.

```yaml
# handlers/main.yml
---
- name: Restart nginx
  ansible.builtin.service: { name: nginx, state: restarted }
  listen: "Restart nginx"

- name: Reload nginx
  ansible.builtin.service: { name: nginx, state: reloaded }
  listen: "Reload nginx"
```

## `meta/main.yml` — dependencies

```yaml
---
dependencies:
  - role: common
  - role: geerlingguy.git   # also pinned in requirements.yml
    vars:
      git_version: "2.40"
collections:
  - community.general
  - ansible.posix

galaxy_info:
  role_name: my_role
  author: Your Team
  description: What this role does
  license: MIT
  min_ansible_version: "2.20"
  platforms:
    - name: Ubuntu
      versions: [jammy, noble]
    - name: EL
      versions: ["9"]
```

## Task key order

Lint enforces only `name` first and `block`/`rescue`/`always` last. Convention:

```text
name → module → when → loop → register → notify → tags → block/rescue/always
```
