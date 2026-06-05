const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(p) {
  return fs.readFileSync(path.resolve(ROOT, p), 'utf8');
}

function write(p, content) {
  fs.writeFileSync(path.resolve(ROOT, p), content);
}

function stripFrontmatter(md) {
  const body = md.replace(/^---\n[\s\S]*?---\n/, '').trimStart();
  return body;
}

function splitSections(body) {
  const sections = {};
  const parts = body.split(/\n(?=^## )/m);

  for (const part of parts) {
    const m = part.match(/^## (.+)\n/);
    if (m) {
      sections[m[1]] = part.trim();
    } else {
      sections['__intro__'] = part.trim();
    }
  }
  return sections;
}

function parseSkill() {
  const body = stripFrontmatter(read('src/agents/opencode/skills/ansible.SKILL.md'));
  const sections = splitSections(body);

  const intro = sections['__intro__'] || '';
  const tableMatch = intro.match(
    /\| Tool \| What \| Inventory \| SSH \|\n\|[-| ]+\|\n(?:\| `\w+` \| .+ \|\n)+(?:\| `\w+` \| .+\|)?/
  );
  sections['MCP Tools'] = tableMatch
    ? `## MCP Tools\n\n${tableMatch[0].trimEnd()}`
    : '';

  // Ensure each section ends with exactly one trailing newline
  for (const key of Object.keys(sections)) {
    if (key !== '__intro__' && sections[key]) {
      sections[key] = sections[key].trimEnd();
    }
  }

  return sections;
}

function parseActivate() {
  const sections = splitSections(read('src/rules/ansible-activate.md'));

  // MCP table lives under "MCP Tools Quick Reference" heading
  const mcpSection = sections['MCP Tools Quick Reference'] || '';

  const tableMatch = mcpSection.match(
    /\| Tool \| .+ \|\n\|[-| ]+\|\n(?:\| `\w+` \| .+ \|\n)+/
  );
  sections['MCP Tools Table'] = tableMatch ? tableMatch[0].trimEnd() : '';

  // MCP server info line (last line of the MCP section)
  const mcpMatch = mcpSection.match(/MCP server:.+$/m);
  sections['MCP Info'] = mcpMatch ? mcpMatch[0] : '';

  // Steering files content without heading
  const steeringRaw = sections['Steering Files'] || '';
  sections['Steering Files Body'] = steeringRaw
    .replace(/^## Steering Files\n/, '')
    .trim();

  return sections;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

function generateClaude() {
  const s = parseSkill();
  return `# Ansible Copilot

You are an Ansible expert. MCP server \`mcp-ansible\` provides 6 tools for Ansible development. Use them for every Ansible task.

${s['MCP Tools']}

${s['Validation Order']}

${s['Core Rules']}

${s['Steering Files']}

${s['Tool Arguments']}

${s['Workflows']}

${s['Troubleshooting']}
`;
}

function generateAgent() {
  const s = parseSkill();
  return `---
name: ansible
description: Ansible expert for playbooks, roles, inventory, and linting.
---

# Ansible Subagent

You are an Ansible expert subagent. Offload all Ansible-specific tasks (playbook creation, role scaffolding, linting, Jinja2 templates, inventory management, vault encryption) to you.

Use the MCP tools (\`lint_file\`, \`syntax_check\`, \`diff_check\`, \`gather_facts\`, \`list_hosts\`, \`list_tags\`) for every Ansible task.

${s['MCP Tools']}

${s['Validation Order']}

${s['Core Rules']}

${s['Steering Files']}

${s['Tool Arguments']}

${s['Troubleshooting']}
`;
}

function generateCopilot() {
  const s = parseSkill();
  const a = parseActivate();

  return `# Ansible Copilot

You are an Ansible expert. Use MCP tools for every Ansible task: \`lint_file\`, \`syntax_check\`, \`diff_check\`, \`gather_facts\`, \`list_hosts\`, \`list_tags\`.

## Core Rules

- FQCN only: \`ansible.builtin.<name>\` or \`<collection>.<name>\`
- Mode as ugo string: \`mode: 'u=rw,g=r,o='\`
- Pin versions, never \`state: latest\`
- Every task has a name, uppercase first char
- \`command\`/\`shell\` use \`cmd:\` key + \`changed_when:\`
- Tags on every task
- \`true\`/\`false\` only, never \`yes\`/\`no\`
- Role vars prefixed with role name

${s['Validation Order']}

## Steering Files

${a['Steering Files Body']}

## MCP Tools

${a['MCP Tools Table']}

${a['MCP Info']}

Requires \`uv\`: \`curl -LsSf https://astral.sh/uv/install.sh | sh\`
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const targets = {
  claude: { fn: generateClaude, path: 'CLAUDE.md', desc: 'Claude Code context' },
  agent: { fn: generateAgent, path: 'src/agents/opencode/agents/ansible.agent.md', desc: 'OpenCode subagent' },
  copilot: { fn: generateCopilot, path: '.github/copilot-instructions.md', desc: 'GitHub Copilot instructions' },
};

function sync(nameOrAll) {
  const entries = nameOrAll && nameOrAll !== 'all'
    ? [[nameOrAll, targets[nameOrAll]]].filter(([, t]) => t)
    : Object.entries(targets);

  if (entries.length === 0) {
    console.error(`Unknown target: ${nameOrAll}`);
    console.error(`Known targets: ${Object.keys(targets).join(', ')}, all`);
    process.exit(1);
  }

  for (const [name, t] of entries) {
    write(t.path, t.fn());
    console.log(`✓ ${t.path}  (${t.desc})`);
  }
}

function check() {
  let dirty = false;
  for (const [name, t] of Object.entries(targets)) {
    const generated = t.fn();
    const existing = read(t.path);
    if (generated !== existing) {
      console.error(`✗ ${t.path} is out of sync — run 'node scripts/sync.js'`);
      dirty = true;
    }
  }
  if (!dirty) {
    console.log('✓ all files in sync');
    return;
  }
  process.exit(1);
}

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === '--check') {
    check();
  } else {
    sync(cmd);
  }
}
