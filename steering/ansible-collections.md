# Ansible Collections – Project Conventions

Project pin all non-builtin collections in `requirements.yml`. Full docs:
<https://docs.ansible.com/ansible/latest/collections_guide/> and
<https://galaxy.ansible.com>.

## Rules

1. **Always FQCN** (`namespace.collection.module`) — never bare module name or `collections:` keyword on play.
2. **Pin in `requirements.yml`** — exact version (`"8.6.0"`) or minimum (`">=8.0.0"`). Never unpinned.
3. **Declare collection deps in role meta** (`roles/<name>/meta/main.yml`) when role uses non-builtin modules.
4. **Document Python deps** — many collections need extra pip packages; list in role/playbook README.

## `requirements.yml` shape

```yaml
---
collections:
  - name: community.general
    version: ">=8.0.0"
  - name: ansible.posix
    version: ">=1.5.0"
  - name: amazon.aws
    version: ">=9.0.0"
  - name: community.docker
    version: ">=3.0.0"

roles:
  - name: geerlingguy.nginx
    version: "3.1.4"
```

Install: `ansible-galaxy install -r requirements.yml`

## Role meta declaration

```yaml
# roles/<role>/meta/main.yml
---
dependencies: []
collections:
  - community.general
  - ansible.posix
```

## Popular collections — module catalog

LLM agents: do **not** invent module names. Verify with `ansible-doc -l <collection>`.

### Key collections (verify modules with `ansible-doc -l <collection>`)

| Collection | Domain | `pip install` |
|---|---|---|
| `community.general` | General-purpose (docker, npm, terraform, ini_file, archive) | – |
| `ansible.posix` | POSIX (firewalld, selinux, mount, sysctl, authorized_key) | – |
| `amazon.aws` | AWS (ec2, s3, rds, iam, cloudformation) | `boto3` `botocore` |
| `community.docker` | Docker (container, image, network, compose_v2) | `docker` |
| `kubernetes.core` | K8s (k8s, helm, k8s_info) | `kubernetes` |
| `community.postgresql` | PostgreSQL (db, user, query, privs) | `psycopg2-binary` |
| `community.mysql` | MySQL (db, user, query) | `PyMySQL` |

## Usage example

```yaml
- name: Install nginx container
  community.docker.docker_container:
    name: nginx
    image: nginx:1.27.0
    state: started
    ports: ["80:80"]
```

## Custom collection — skeleton

Only when extracting in-repo modules into distributable package.

```bash
ansible-galaxy collection init my_namespace.my_collection
```

```text
my_namespace/my_collection/
├── galaxy.yml        # namespace, name, version, deps
├── README.md
├── plugins/{modules,inventory,lookup,filter}/
├── roles/
├── playbooks/
└── tests/
```

Build + install locally:

```bash
ansible-galaxy collection build
ansible-galaxy collection install my_namespace-my_collection-1.0.0.tar.gz
```

## CLI quick reference

| Command | Use |
|---|---|
| `ansible-galaxy collection install <name>` | install single collection |
| `ansible-galaxy collection install -r requirements.yml` | install from file |
| `ansible-galaxy collection install -r requirements.yml --upgrade` | update existing |
| `ansible-galaxy collection list` | list installed |
| `ansible-doc <ns>.<col>.<mod>` | module docs |
| `ansible-doc -l <ns>.<col>` | list all modules in collection |
| `ansible-galaxy collection build` | build tarball |
| `ansible-galaxy collection publish <tarball>` | publish to Galaxy |

## Troubleshooting

- **"Module not found"** → collection missing or wrong FQCN. Check `ansible-galaxy collection list` and `ansible-doc -l <collection>`.
- **Version conflict** → multiple paths have same collection. Check `collections_path` in `ansible.cfg`.
- **"Python library missing"** → install collection's pip deps (table above).
