# Ansible Playbook Workflow

## Required Structure of Every Playbook

```yaml
---
- name: <Short, precise description>
  hosts: <group_or_host>
  gather_facts: true          # set explicitly
  become: false               # only true if root is strictly required
  tags:
    - <playbook-name>

  vars:
    # No passwords here! → ansible-vault, env vars, CI/CD secrets, or external secret managers (e.g. HashiCorp Vault)

  pre_tasks:
    - name: Assert prerequisites
      ansible.builtin.assert:
        that: [...]
      tags: always

  tasks:
    - name: <Verb + Noun, e.g. "Install nginx package">
      ansible.builtin.<module>:
        ...
      tags: [...]
      notify: <handler if needed>

  handlers:
    - name: <Uppercase, descriptive>
      ansible.builtin.service:
        ...
```

## Task Naming Conventions

- Format: `Verb + Object` → "Install nginx", "Configure sshd", "Start application"
- Language: English
- No abbreviations: `Configure` not `Cfg`
- ansible-lint `name[casing]`: first letter MUST uppercase
- ansible-lint `name[missing]`: every task MUST have `name:`

## no-free-form – never use inline command syntax

```yaml
# GOOD
- name: Run migration
  ansible.builtin.command:
    cmd: /usr/bin/migrate --env production

# BAD ansible-lint will fail
- name: Run migration
  ansible.builtin.command: /usr/bin/migrate --env production
```

## What NEVER Belongs in a Playbook

- Plain-text passwords → `ansible-vault encrypt_string` or external (CI/CD secrets, HashiCorp Vault) via `-e`
- `ignore_errors: true` without comment why
- `shell:` or `command:` when Ansible module exists
- `yes`/`no`/`True`/`False` booleans → always `true`/`false` (`yaml[truthy]`)

## Tags Strategy

Every play + task gets tags:

```yaml
tags:
  - install     # for installation tasks
  - configure   # for configuration tasks
  - service     # for service management
  - never       # for tasks that should only run explicitly
```

## Idempotency Checklist

Check before commit:

- [ ] Playbook runs twice without errors + no unwanted changes?
- [ ] All `command:`/`shell:` tasks have `changed_when:`?
- [ ] `command:`/`shell:` tasks with unreliable exit codes have `failed_when:`?
- [ ] Files with `state: present` not constantly rewritten?
