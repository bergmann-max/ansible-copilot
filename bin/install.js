#!/usr/bin/env node
// ansible-copilot — unified cross-platform installer for 5 AI coding agents.
//
// Distribution:
//   Local clone: node bin/install.js [flags]
//   curl|bash:    delegated from install.sh shim → npx -y github:REPO -- [flags]
//   Windows:      pwsh install.ps1 [flags] → same npx delegation
//
// Pure stdlib, zero npm runtime deps.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const child_process = require('child_process');
const readline = require('readline');

const SETTINGS = require('./lib/settings');

const REPO = 'bergmann-max/ansible-copilot';
const MCP_SERVER_REF = 'git+https://github.com/bergmann-max/mcp-ansible.git@0.3.0';
const INIT_SENTINEL = 'You are an Ansible expert';
const INIT_BEGIN = '<!-- ansible-copilot-begin -->';
const INIT_END = '<!-- ansible-copilot-end -->';

// ── Argv ───────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    dryRun: false, force: false,
    withInit: false, withMcpServer: true,
    all: false, minimal: false, listOnly: false, noColor: false,
    only: [], uninstall: false, nonInteractive: false,
    configDir: null, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run':        opts.dryRun = true; break;
      case '--force':          opts.force = true; break;
      case '--with-init':      opts.withInit = true; break;
      case '--no-mcp-server':  opts.withMcpServer = false; break;
      case '--all':            opts.all = true; break;
      case '--minimal':        opts.minimal = true; break;
      case '--list':           opts.listOnly = true; break;
      case '--no-color':       opts.noColor = true; break;
      case '--uninstall':
      case '-u':               opts.uninstall = true; break;
      case '--non-interactive': opts.nonInteractive = true; break;
      case '-h':
      case '--help':           opts.help = true; break;
      case '--': break;
      case '--only': {
        const v = argv[++i];
        if (!v) die('error: --only requires an argument');
        opts.only.push(v);
        break;
      }
      case '--config-dir': {
        const v = argv[++i];
        if (!v || v.startsWith('--')) die('error: --config-dir requires a path');
        opts.configDir = expandHome(v);
        break;
      }
      default:
        die(`error: unknown flag: ${a}\n  run 'ansible-copilot --help' for usage`);
    }
  }
  if (opts.all && opts.minimal) die('error: --all and --minimal are mutually exclusive');
  if (opts.all) opts.withInit = true;
  if (opts.minimal) opts.withInit = false;
  // Validate --only ids against the provider matrix
  if (opts.only.length) {
    const knownIds = new Set(PROVIDERS.map(p => p.id));
    for (const id of opts.only) {
      if (!knownIds.has(id)) {
        die(`error: unknown agent: ${id}\n  see 'ansible-copilot --list' for valid ids`);
      }
    }
  }
  return opts;
}

function die(msg) { process.stderr.write(msg + '\n'); process.exit(2); }

// ── Color helpers ──────────────────────────────────────────────────────────
function makeChalk(noColor) {
  const useColor = !noColor && process.stdout.isTTY && !process.env.NO_COLOR;
  const wrap = (codes) => (s) => useColor ? `\x1b[${codes}m${s}\x1b[0m` : s;
  return {
    orange: wrap('38;5;172'), dim: wrap('2'), red: wrap('31'),
    green: wrap('32'), yellow: wrap('33'),
  };
}

// ── Env guards ─────────────────────────────────────────────────────────────
function checkWslWindowsNode() {
  if (process.platform !== 'win32') return;
  if (process.env.WSL_DISTRO_NAME) {
    die('ansible-copilot: detected Windows Node.js running inside WSL.\n' +
        '         Install Linux-native Node inside your WSL distro and re-run there.\n' +
        '         (WSL_DISTRO_NAME=' + process.env.WSL_DISTRO_NAME + ')');
  }
  try {
    const v = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
    if (v.includes('microsoft') || v.includes('wsl')) {
      die('ansible-copilot: detected Windows Node.js running inside WSL (/proc/version).\n' +
          '         Install Linux-native Node inside your WSL distro and re-run there.');
    }
  } catch (_) { /* /proc/version absent on real Windows — fine */ }
}

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) die(`ansible-copilot: Node ${process.versions.node} too old. Need Node >=18. https://nodejs.org`);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function expandHome(p) { return p.replace(/^\$HOME/, os.homedir()).replace(/^~/, os.homedir()); }

function hasCmd(cmd) {
  try {
    if (process.platform === 'win32') {
      const r = child_process.spawnSync('where', [cmd], { stdio: 'ignore' });
      return r.status === 0;
    }
    const r = child_process.spawnSync('sh', ['-c', `command -v ${shellEscape(cmd)}`], { stdio: 'ignore' });
    return r.status === 0;
  } catch (_) { return false; }
}

function shellEscape(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

function absoluteNodePath() { return process.execPath; }

// ── Cross-platform spawning ────────────────────────────────────────────────
const IS_WIN = process.platform === 'win32';

function quoteWinArg(a) {
  if (!IS_WIN) return a;
  if (a === '' || /[\s"]/.test(a)) {
    return '"' + String(a).replace(/\\(?=\\*"|$)/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return a;
}

function spawnXplat(cmd, args, opts) {
  if (IS_WIN) {
    const quoted = args.map(quoteWinArg).join(' ');
    return child_process.spawnSync(`${cmd} ${quoted}`, [], Object.assign({ shell: true }, opts || {}));
  }
  return child_process.spawnSync(cmd, args, opts || {});
}

function runSpawn(cmd, args, opts, dry) {
  if (dry) { process.stdout.write(`  would run: ${cmd} ${args.join(' ')}\n`); return { status: 0 }; }
  process.stdout.write(`  $ ${cmd} ${args.join(' ')}\n`);
  return spawnXplat(cmd, args, Object.assign({ stdio: 'inherit' }, opts || {}));
}

function captureSpawn(cmd, args) {
  try { return spawnXplat(cmd, args, { encoding: 'utf8' }); }
  catch (_) { return { status: 1, stdout: '', stderr: '' }; }
}

// ── Provider matrix ────────────────────────────────────────────────────────
const PROVIDERS = [
  { id: 'opencode',  label: 'OpenCode',    mech: 'native opencode plugin',       detect: 'command:opencode||dir:$HOME/.config/opencode' },
  { id: 'claude',    label: 'Claude Code',  mech: 'claude plugin install',        detect: 'command:claude' },
  { id: 'gemini',    label: 'Gemini CLI',   mech: 'gemini extensions install',    detect: 'command:gemini' },
  { id: 'codex',     label: 'OpenAI Codex', mech: 'per-repo init file',           detect: 'command:codex',              soft: true },
  { id: 'copilot',   label: 'GitHub Copilot',mech: 'per-repo init file',          detect: 'command:copilot',            soft: true },
];

// ── Detection ──────────────────────────────────────────────────────────────
function vscodeExtPresent(needle) {
  const home = os.homedir();
  const roots = [
    path.join(home, '.vscode/extensions'),
    path.join(home, '.vscode-server/extensions'),
    path.join(home, '.cursor/extensions'),
    path.join(home, '.windsurf/extensions'),
  ];
  const re = new RegExp(needle, 'i');
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    let entries;
    try { entries = fs.readdirSync(r); } catch (_) { continue; }
    if (entries.some(e => re.test(e))) return true;
  }
  return false;
}

function safeStat(p, method) {
  try { return fs.statSync(p)[method](); } catch (_) { return false; }
}

function detectMatch(spec) {
  if (!spec) return false;
  for (const clause of spec.split('||')) {
    const c = clause.trim();
    if (!c) continue;
    const colon = c.indexOf(':');
    const kind = colon === -1 ? c : c.slice(0, colon);
    const val  = colon === -1 ? '' : expandHome(c.slice(colon + 1));
    let ok = false;
    switch (kind) {
      case 'command':    ok = hasCmd(val); break;
      case 'dir':        ok = safeStat(val, 'isDirectory'); break;
      case 'file':       ok = safeStat(val, 'isFile'); break;
      case 'vscode-ext': ok = vscodeExtPresent(val); break;
    }
    if (ok) return true;
  }
  return false;
}

// ── Repo root resolution ───────────────────────────────────────────────────
function detectRepoRoot() {
  const here = path.dirname(__filename);
  const root = path.resolve(here, '..');
  if (fs.existsSync(path.join(root, 'ANSIBLE.md')) && fs.existsSync(path.join(root, 'steering'))) {
    return root;
  }
  return null;
}

// ── Per-provider installers ────────────────────────────────────────────────
function opencodeConfigDir() {
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'opencode');
  if (IS_WIN) return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'opencode');
  return path.join(os.homedir(), '.config', 'opencode');
}

function opencodeConfigFile(dir) {
  // Prefer .jsonc (current OpenCode default)
  const jsonc = path.join(dir, 'opencode.jsonc');
  const json = path.join(dir, 'opencode.json');
  if (fs.existsSync(jsonc)) return jsonc;
  if (fs.existsSync(json)) return json;
  return jsonc; // default to .jsonc for new installs
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function installOpencode(ctx) {
  const { say, note, warn, opts, repoRoot, results } = ctx;
  results.detected++;
  say('→ OpenCode detected');

  if (!repoRoot) {
    warn('  opencode native install requires a local clone of the ansible-copilot repo.');
    note('  Re-run from a clone: git clone https://github.com/' + REPO + ' && cd ansible-copilot && node bin/install.js --only opencode');
    results.failed.push(['opencode', 'native install requires local repo clone']);
    process.stdout.write('\n');
    return;
  }

  const dir = opts.configDir || opencodeConfigDir();
  const pluginDir   = path.join(dir, 'plugins', 'ansible');
  const skillsDir   = path.join(dir, 'skills', 'ansible');
  const agentsDir   = path.join(dir, 'agents');
  const commandsDir = path.join(dir, 'commands');
  const pluginSrc   = path.join(repoRoot, 'src', 'agents', 'opencode');
  const opencodeJson = opencodeConfigFile(dir);
  const agentsMd     = path.join(dir, 'AGENTS.md');

  if (opts.dryRun) {
    note(`  would mkdir ${pluginDir}/, ${skillsDir}/, ${agentsDir}/, ${commandsDir}/`);
    note(`  would copy plugin.json + SKILL.md + agent.md into ${pluginDir}/`);
    note(`  would copy steering files`);
    note(`  would copy SKILL.md into ${skillsDir}/`);
    note(`  would copy agent.md into ${agentsDir}/`);
    note(`  would copy ansible-copilot.md into ${commandsDir}/`);
    note(`  would patch ${opencodeJson}`);
    note(`  would write ruleset to ${agentsMd}`);
    results.installed.push('opencode');
    process.stdout.write('\n');
    return;
  }

  try {
    // 1. Plugin dir
    fs.mkdirSync(pluginDir, { recursive: true });
    const pluginPayload = [
      [path.join(pluginSrc, 'plugin.json'), path.join(pluginDir, 'plugin.json')],
      [path.join(pluginSrc, 'skills', 'ansible.SKILL.md'), path.join(pluginDir, 'skills', 'ansible.SKILL.md')],
      [path.join(pluginSrc, 'agents', 'ansible.agent.md'), path.join(pluginDir, 'agents', 'ansible.agent.md')],
    ];
    for (const [src, dest] of pluginPayload) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest) && !opts.force) {
        note(`  skipped ${dest} (exists; --force to overwrite)`);
        continue;
      }
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, dest);
    }
    process.stdout.write(`  installed: ${pluginDir}\n`);

    // 2. Steering files
    const steeringSrc = path.join(repoRoot, 'steering');
    const steeringDest = path.join(pluginDir, 'steering');
    copyDirRecursive(steeringSrc, steeringDest);
    process.stdout.write(`  installed: ${steeringDest}\n`);

    // 3. Skills — opencode auto-discovers from ~/.config/opencode/skills/
    fs.mkdirSync(skillsDir, { recursive: true });
    const skillSrc = path.join(pluginSrc, 'skills', 'ansible.SKILL.md');
    const skillDest = path.join(skillsDir, 'SKILL.md');
    if (fs.existsSync(skillDest) && !opts.force) {
      note(`  skipped ${skillDest} (exists; --force to overwrite)`);
    } else {
      fs.copyFileSync(skillSrc, skillDest);
      process.stdout.write(`  installed: ${skillDest}\n`);
    }

    // 4. Subagents
    fs.mkdirSync(agentsDir, { recursive: true });
    const agentSrc = path.join(pluginSrc, 'agents', 'ansible.agent.md');
    const agentDest = path.join(agentsDir, 'ansible.agent.md');
    if (fs.existsSync(agentDest) && !opts.force) {
      note(`  skipped ${agentDest} (exists; --force to overwrite)`);
    } else {
      fs.copyFileSync(agentSrc, agentDest);
      process.stdout.write(`  installed: ${agentDest}\n`);
    }

    // 5. Commands — opencode auto-discovers from ~/.config/opencode/commands/
    fs.mkdirSync(commandsDir, { recursive: true });
    const cmdSrc = path.join(pluginSrc, 'commands', 'ansible-copilot.md');
    const cmdDest = path.join(commandsDir, 'ansible-copilot.md');
    if (fs.existsSync(cmdSrc)) {
      if (fs.existsSync(cmdDest) && !opts.force) {
        note(`  skipped ${cmdDest} (exists; --force to overwrite)`);
      } else {
        fs.copyFileSync(cmdSrc, cmdDest);
        process.stdout.write(`  installed: ${cmdDest}\n`);
      }
    }

    // 6. AGENTS.md — always-on ruleset. Marker-fenced for clean uninstall.
    const ruleBody = fs.readFileSync(path.join(repoRoot, 'src', 'rules', 'ansible-activate.md'), 'utf8').trimEnd() + '\n';
    const fencedBlock = `${INIT_BEGIN}\n${ruleBody}${INIT_END}\n`;
    if (fs.existsSync(agentsMd)) {
      const existing = fs.readFileSync(agentsMd, 'utf8');
      const alreadyFenced = existing.includes(INIT_BEGIN) && existing.includes(INIT_END);
      const alreadyBySentinel = !alreadyFenced && existing.includes(INIT_SENTINEL);
      if (alreadyFenced) {
        note(`  ${agentsMd} already contains ansible-copilot ruleset`);
      } else if (alreadyBySentinel) {
        note(`  ${agentsMd} contains legacy ansible block — leaving as-is`);
        note('  re-run with --force to replace with fenced block');
        if (opts.force) {
          fs.writeFileSync(agentsMd, fencedBlock, { mode: 0o644 });
          process.stdout.write(`  rewrote ${agentsMd} with fenced ansible-copilot block\n`);
        }
      } else {
        const sep = existing.endsWith('\n\n') ? '' : (existing.endsWith('\n') ? '\n' : '\n\n');
        fs.writeFileSync(agentsMd, existing + sep + fencedBlock, { mode: 0o644 });
        process.stdout.write(`  appended ansible-copilot ruleset to ${agentsMd}\n`);
      }
    } else {
      fs.writeFileSync(agentsMd, fencedBlock, { mode: 0o644 });
      process.stdout.write(`  installed: ${agentsMd}\n`);
    }

    // 6. opencode.json — add plugin + optional MCP server config
    let cfg = SETTINGS.readSettings(opencodeJson);
    if (cfg === null) {
      warn(`  ${opencodeJson} unparseable; will not touch it. Edit manually then re-run.`);
      results.failed.push(['opencode', 'opencode.json unparseable']);
      process.stdout.write('\n');
      return;
    }
    // Backup once
    const opencodeBak = opencodeJson + '.bak';
    if (fs.existsSync(opencodeJson) && !fs.existsSync(opencodeBak)) {
      try { fs.copyFileSync(opencodeJson, opencodeBak); } catch (_) {}
    }

    const patches = { 'plugins.ansible': { enabled: true } };
    if (opts.withMcpServer) {
      patches['mcpServers.mcp-ansible'] = {
        command: 'uvx',
        args: ['--from', MCP_SERVER_REF, 'mcp-ansible'],
      };
      process.stdout.write('  registered mcp-ansible server\n');
    }

    if (!opts.dryRun) SETTINGS.patchSettings(opencodeJson, patches, []);
    process.stdout.write(`  patched: ${opencodeJson}\n`);

    results.installed.push('opencode');
  } catch (e) {
    warn('  opencode install failed: ' + (e && e.message || e));
    results.failed.push(['opencode', (e && e.message) || 'unknown error']);
  }
  process.stdout.write('\n');
}

function installClaude(ctx) {
  const { say, note, opts, results, repoRoot } = ctx;
  results.detected++;
  say('→ Claude Code detected');

  // Plugin install (idempotent unless --force)
  let alreadyInstalled = false;
  if (!opts.force) {
    const r = captureSpawn('claude', ['plugin', 'list']);
    if (r.status === 0 && /ansible/i.test(r.stdout || '')) alreadyInstalled = true;
  }
  if (alreadyInstalled) {
    note('  ansible-copilot plugin already installed (use --force to reinstall)');
    results.skipped.push(['claude', 'plugin already installed']);
  } else {
    const r1 = runSpawn('claude', ['plugin', 'marketplace', 'add', REPO], null, opts.dryRun);
    const r2 = runSpawn('claude', ['plugin', 'install', 'ansible-copilot@ansible-copilot'], null, opts.dryRun);
    if (r1.status === 0 && r2.status === 0) results.installed.push('claude');
    else results.failed.push(['claude', 'claude plugin install failed']);
  }

  // MCP server config
  if (opts.withMcpServer) {
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const settingsPath = path.join(claudeDir, 'settings.json');
    let settings = SETTINGS.readSettings(settingsPath);
    if (settings === null) {
      say('  settings.json unparseable; will not touch MCP config. Edit manually.');
    } else {
      const bak = settingsPath + '.bak';
      if (fs.existsSync(settingsPath) && !fs.existsSync(bak)) {
        try { fs.copyFileSync(settingsPath, bak); } catch (_) {}
      }
      if (!opts.dryRun) {
        SETTINGS.patchSettings(settingsPath, {
          'mcpServers.mcp-ansible': {
            command: 'uvx',
            args: ['--from', MCP_SERVER_REF, 'mcp-ansible'],
          },
        }, []);
        process.stdout.write(`  registered mcp-ansible in ${settingsPath}\n`);
      }
    }
  }

  // Command file
  if (repoRoot) {
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const cmdDir = path.join(claudeDir, 'commands');
    const cmdSrc = path.join(repoRoot, 'src', 'agents', 'claude', 'commands', 'ansible-copilot.md');
    const cmdDest = path.join(cmdDir, 'ansible-copilot.md');
    if (fs.existsSync(cmdSrc)) {
      if (opts.dryRun) {
        note(`  would copy ansible-copilot.md into ${cmdDir}/`);
      } else {
        fs.mkdirSync(cmdDir, { recursive: true });
        if (fs.existsSync(cmdDest) && !opts.force) {
          note(`  skipped ${cmdDest} (exists; --force to overwrite)`);
        } else {
          fs.copyFileSync(cmdSrc, cmdDest);
          process.stdout.write(`  installed: ${cmdDest}\n`);
        }
      }
    }
  }

  process.stdout.write('\n');
}

function installGemini(ctx) {
  const { say, note, opts, results, repoRoot } = ctx;
  results.detected++;
  say('→ Gemini CLI detected');

  if (!opts.force) {
    const r = captureSpawn('gemini', ['extensions', 'list']);
    if (r.status === 0 && /ansible/i.test(r.stdout || '')) {
      note('  ansible extension already installed (use --force to reinstall)');
      results.skipped.push(['gemini', 'extension already installed']);
      process.stdout.write('\n');
      return;
    }
  }
  const r = runSpawn('gemini', ['extensions', 'install', `https://github.com/${REPO}`], null, opts.dryRun);
  if (r.status === 0) results.installed.push('gemini');
  else results.failed.push(['gemini', 'gemini extensions install failed']);

  // Command file
  if (repoRoot) {
    const geminiDir = process.env.GEMINI_CONFIG_DIR || path.join(os.homedir(), '.gemini');
    const cmdDir = path.join(geminiDir, 'commands');
    const cmdSrc = path.join(repoRoot, 'src', 'agents', 'gemini', 'commands', 'ansible-copilot.toml');
    const cmdDest = path.join(cmdDir, 'ansible-copilot.toml');
    if (fs.existsSync(cmdSrc)) {
      if (opts.dryRun) {
        note(`  would copy ansible-copilot.toml into ${cmdDir}/`);
      } else {
        fs.mkdirSync(cmdDir, { recursive: true });
        if (fs.existsSync(cmdDest) && !opts.force) {
          note(`  skipped ${cmdDest} (exists; --force to overwrite)`);
        } else {
          fs.copyFileSync(cmdSrc, cmdDest);
          process.stdout.write(`  installed: ${cmdDest}\n`);
        }
      }
    }
  }

  process.stdout.write('\n');
}

function installViaInit(ctx) {
  const { say, results, prov } = ctx;
  say(`  Use --with-init to install rule files into the current workspace.`);
  results.skipped.push([prov.id, 'use --with-init to install per-repo rules']);
}

// ── Uninstall ──────────────────────────────────────────────────────────────
function uninstall(ctx) {
  const { say, note, ok, warn, opts } = ctx;
  say('⚡ ansible-copilot uninstall');

  if (opts.dryRun) note('  (dry run — nothing will be removed)');

  // Determine which providers to uninstall
  const onlyNone = !opts.only.length;

  // opencode native install — strip plugin, MCP, and files
  if (onlyNone || opts.only.includes('opencode')) {
  const ocDir = opts.configDir || opencodeConfigDir();
  const ocPluginDir = path.join(ocDir, 'plugins', 'ansible');
  if (fs.existsSync(ocPluginDir)) {
    const ocJson = opencodeConfigFile(ocDir);
    if (fs.existsSync(ocJson)) {
      const cfg = SETTINGS.readSettings(ocJson);
      if (cfg) {
        const removals = [];
        if (cfg.plugins && cfg.plugins.ansible) {
          if (Object.keys(cfg.plugins).length === 1) removals.push('plugins');
          else removals.push('plugins.ansible');
        }
        if (cfg.mcpServers && typeof cfg.mcpServers === 'object' && cfg.mcpServers['mcp-ansible']) {
          if (Object.keys(cfg.mcpServers).length === 1) removals.push('mcpServers');
          else removals.push('mcpServers.mcp-ansible');
        }
        if (!opts.dryRun && removals.length) SETTINGS.patchSettings(ocJson, {}, removals);
        say(`  pruned ansible-copilot entries from ${ocJson}`);
      }
    }
    if (!opts.dryRun) { try { fs.rmSync(ocPluginDir, { recursive: true, force: true }); } catch (_) {} }
    note(`  removed ${ocPluginDir}`);

    // Strip fenced block from AGENTS.md
    const ocAgentsMd = path.join(ocDir, 'AGENTS.md');
    if (fs.existsSync(ocAgentsMd)) {
      const body = fs.readFileSync(ocAgentsMd, 'utf8');
      const begin = body.indexOf(INIT_BEGIN);
      const end = body.indexOf(INIT_END);
      if (begin !== -1 && end !== -1 && end > begin) {
        const before = body.slice(0, begin).replace(/\n+$/, '\n');
        const after = body.slice(end + INIT_END.length).replace(/^\n+/, '\n');
        let next = (before + after).trimEnd();
        next = next ? next + '\n' : '';
        if (!opts.dryRun) {
          if (next === '') {
            try { fs.unlinkSync(ocAgentsMd); } catch (_) {}
          } else {
            fs.writeFileSync(ocAgentsMd, next, { mode: 0o644 });
          }
        }
        say(next === '' ? `  removed ${ocAgentsMd}` : `  stripped ansible-copilot block from ${ocAgentsMd}`);
      } else if (body.includes(INIT_SENTINEL)) {
        if (!opts.dryRun) { try { fs.unlinkSync(ocAgentsMd); } catch (_) {} }
        note(`  removed ${ocAgentsMd} (legacy block)`);
      }
    }

    // Global skills and agents
    for (const p of [path.join(ocDir, 'skills', 'ansible'), path.join(ocDir, 'agents', 'ansible.agent.md')]) {
      if (fs.existsSync(p) && !opts.dryRun) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
    }

    // Command file
    const cmdFile = path.join(ocDir, 'commands', 'ansible-copilot.md');
    if (fs.existsSync(cmdFile) && !opts.dryRun) {
      try { fs.unlinkSync(cmdFile); } catch (_) {}
      note(`  removed ${cmdFile}`);
    }
  }
  }

  // Claude plugin — only if not filtered by --only
  if ((onlyNone || opts.only.includes('claude')) && hasCmd('claude')) {
    const probe = captureSpawn('claude', ['plugin', 'list']);
    if (probe.status === 0 && /ansible/i.test(probe.stdout || '')) {
      const r = runSpawn('claude', ['plugin', 'uninstall', 'ansible-copilot@ansible-copilot'], null, opts.dryRun);
      if (r.status === 0) ok('  removed claude plugin');
    } else {
      note('  claude plugin not installed — skipping');
    }

    // Prune MCP from settings.json
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const settingsPath = path.join(claudeDir, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      let settings = SETTINGS.readSettings(settingsPath);
      if (settings && settings.mcpServers && settings.mcpServers['mcp-ansible']) {
        const removals = [];
        if (Object.keys(settings.mcpServers).length === 1) {
          removals.push('mcpServers');
        } else {
          removals.push('mcpServers.mcp-ansible');
        }
        if (!opts.dryRun) SETTINGS.patchSettings(settingsPath, {}, removals);
        ok('  pruned mcp-ansible from settings.json');
      }
    }

    // Command file
    const claudeCmd = path.join(claudeDir, 'commands', 'ansible-copilot.md');
    if (fs.existsSync(claudeCmd) && !opts.dryRun) {
      try { fs.unlinkSync(claudeCmd); } catch (_) {}
      note(`  removed ${claudeCmd}`);
    }
  }

  // Gemini extension — only if not filtered by --only
  if ((onlyNone || opts.only.includes('gemini')) && hasCmd('gemini')) {
    const probe = captureSpawn('gemini', ['extensions', 'list']);
    if (probe.status === 0 && /ansible/i.test(probe.stdout || '')) {
      runSpawn('gemini', ['extensions', 'uninstall', 'ansible'], null, opts.dryRun);
    } else {
      note('  gemini extension not installed — skipping');
    }

    // Command file
    const geminiDir = process.env.GEMINI_CONFIG_DIR || path.join(os.homedir(), '.gemini');
    const geminiCmd = path.join(geminiDir, 'commands', 'ansible-copilot.toml');
    if (fs.existsSync(geminiCmd) && !opts.dryRun) {
      try { fs.unlinkSync(geminiCmd); } catch (_) {}
      note(`  removed ${geminiCmd}`);
    }
  }

  // Per-repo init files — strip fenced blocks for all providers that get them
  const initFileProviders = new Set(['opencode', 'codex', 'copilot']);
  if (hasCmd('claude')) initFileProviders.add('claude');
  if (hasCmd('gemini')) initFileProviders.add('gemini');
  if (onlyNone || opts.only.some(id => initFileProviders.has(id))) {
    const cwd = process.cwd();
    const initTargets = [
      '.opencode/AGENTS.md',
      'AGENTS.md',
      '.github/copilot-instructions.md',
      '.codex/instructions.md',
    ];
    if (hasCmd('claude')) initTargets.push('.claude/CLAUDE.md');
    if (hasCmd('gemini')) initTargets.push('.gemini/GEMINI.md');

    for (const rel of initTargets) {
      const p = path.join(cwd, rel);
      if (!fs.existsSync(p)) continue;
      const body = fs.readFileSync(p, 'utf8');
      const begin = body.indexOf(INIT_BEGIN);
      const end = body.indexOf(INIT_END);
      if (begin !== -1 && end !== -1 && end > begin) {
        const before = body.slice(0, begin).replace(/\n+$/, '\n');
        const after = body.slice(end + INIT_END.length).replace(/^\n+/, '\n');
        let next = (before + after).trimEnd();
        next = next ? next + '\n' : '';
        if (!opts.dryRun) {
          if (next === '') {
            try { fs.unlinkSync(p); } catch (_) {}
          } else {
            fs.writeFileSync(p, next, { mode: 0o644 });
          }
        }
        say(next === '' ? `  removed ${rel}` : `  stripped ansible-copilot block from ${rel}`);
      } else if (body.includes(INIT_SENTINEL)) {
        // Legacy unfenced content — remove if file is mainly ours
        const stripped = body.replace(new RegExp(`[\\s\\S]*${INIT_SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*`, 'm'), '').trim();
        if (!stripped || stripped.length < 20) {
          if (!opts.dryRun) { try { fs.unlinkSync(p); } catch (_) {} }
          ok(`  removed ${rel} (legacy block)`);
        } else {
          note(`  left ${rel} in place (mixed legacy content — remove ansible block manually)`);
        }
      }
    }
  }

  process.stdout.write('\n');
  say('uninstall done.');
}

// ── --with-init ────────────────────────────────────────────────────────────
function runInit(ctx) {
  const { say, note, opts, repoRoot } = ctx;
  const cwd = process.cwd();
  const ruleSrc = path.join(repoRoot, 'src', 'rules', 'ansible-activate.md');
  const ruleBody = fs.readFileSync(ruleSrc, 'utf8').trimEnd() + '\n';
  const fencedBlock = `${INIT_BEGIN}\n${ruleBody}${INIT_END}\n`;

  function shouldWrite(id) {
    if (!opts.only.length) return true;
    return opts.only.includes(id);
  }

  const targets = {};
  if (shouldWrite('opencode')) targets['.opencode/AGENTS.md'] = path.join(cwd, '.opencode', 'AGENTS.md');
  targets['AGENTS.md'] = path.join(cwd, 'AGENTS.md');
  if (hasCmd('claude') && shouldWrite('claude')) targets['.claude/CLAUDE.md'] = path.join(cwd, '.claude', 'CLAUDE.md');
  if (hasCmd('gemini') && shouldWrite('gemini')) targets['.gemini/GEMINI.md'] = path.join(cwd, '.gemini', 'GEMINI.md');
  if (shouldWrite('copilot')) targets['.github/copilot-instructions.md'] = path.join(cwd, '.github', 'copilot-instructions.md');
  if (shouldWrite('codex')) targets['.codex/instructions.md'] = path.join(cwd, '.codex', 'instructions.md');

  for (const [label, dest] of Object.entries(targets)) {
    if (opts.dryRun) {
      note(`  would write: ${dest}`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (fs.existsSync(dest)) {
      const existing = fs.readFileSync(dest, 'utf8');
      const alreadyFenced = existing.includes(INIT_BEGIN) && existing.includes(INIT_END);
      if (alreadyFenced) {
        note(`  skipped ${dest} (already contains ansible-copilot block)`);
        continue;
      }
      const alreadyBySentinel = existing.includes(INIT_SENTINEL);
      if (alreadyBySentinel && !opts.force) {
        note(`  skipped ${dest} (contains legacy ansible block; --force to replace with fenced block)`);
        continue;
      }
      if (opts.force && alreadyBySentinel) {
        fs.writeFileSync(dest, fencedBlock, { mode: 0o644 });
        say(`  rewrote ${dest} with fenced block`);
        continue;
      }
      if (!opts.force) {
        note(`  skipped ${dest} (exists; --force to overwrite)`);
        continue;
      }
    }

    fs.writeFileSync(dest, fencedBlock, { mode: 0o644 });
    say(`  wrote: ${dest}`);
  }
}

// ── Interactive prompt ─────────────────────────────────────────────────────
async function promptForOnly(detected) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  if (detected.length === 0) return null;
  process.stdout.write('\nDetected agents:\n');
  detected.forEach((p, i) => process.stdout.write(`  [${i + 1}] ${p.label}\n`));
  process.stdout.write('  [a] all   [q] quit\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise(res => rl.question('Install which? (default: all) ', res));
  rl.close();
  const t = (ans || '').trim().toLowerCase();
  if (t === 'q') process.exit(0);
  if (t === '' || t === 'a' || t === 'all') return null;
  const picks = t.split(/[\s,]+/).map(s => parseInt(s, 10)).filter(n => n >= 1 && n <= detected.length);
  if (picks.length === 0) return null;
  return picks.map(n => detected[n - 1].id);
}

// ── --list ─────────────────────────────────────────────────────────────────
function printList(noColor) {
  const c = makeChalk(noColor);
  process.stdout.write(c.orange('⚡ ansible-copilot provider matrix') + '\n\n');
  process.stdout.write(`  ${pad('ID', 10)} ${pad('AGENT', 18)} DETECTED  AUTO  INSTALL MECHANISM\n`);
  for (const p of PROVIDERS) {
    const det = detectMatch(p.detect);
    const isAuto = !p.soft;
    const detStr = det ? c.green(pad('yes', 9)) : c.dim(pad('no', 9));
    const autoStr = isAuto ? c.green(pad('yes', 5)) : c.dim(pad('no', 5));
    process.stdout.write(`  ${pad(p.id, 10)} ${pad(p.label, 18)} ${detStr} ${autoStr} ${c.dim(p.mech)}\n`);
  }
}

function pad(s, n) { return (s || '').padEnd(n); }

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  checkWslWindowsNode();
  checkNodeVersion();

  const opts = parseArgs(process.argv.slice(2));
  const root = detectRepoRoot();

  if (opts.help) {
    process.stdout.write(`ansible-copilot installer

Usage: node bin/install.js [flags]

Flags:
  --all             Install for all detected agents + per-repo rules
  --minimal         Install plugin + MCP only, no per-repo rules
  --only <id>       Single agent: opencode, claude, gemini, codex, copilot
  --with-init       Drop rule files into current directory
  --no-mcp-server   Skip MCP server config (context files only)
  --dry-run         Print commands, write nothing
  --force           Re-run even if already installed
  --uninstall       Remove everything
  --list            Show agent matrix with detection status
  --no-color        Plain text output
  --config-dir <p>  Override opencode config directory
  --non-interactive Skip TTY prompt, use defaults
  -h, --help        This message
`);
    return;
  }

  if (opts.listOnly) {
    printList(opts.noColor);
    return;
  }

  if (!root) {
    die('error: could not detect repo root. Run from a clone of ansible-copilot.\n' +
        '  git clone https://github.com/' + REPO + ' && cd ansible-copilot && node bin/install.js');
  }

  const chalk = makeChalk(opts.noColor);
  const say = (s) => process.stdout.write(s + '\n');
  const note = (s) => process.stdout.write(chalk.dim('  ' + s) + '\n');
  const ok = (s) => process.stdout.write(chalk.green('  ' + s) + '\n');
  const warn = (s) => process.stdout.write(chalk.yellow('  ' + s) + '\n');

  const results = { detected: 0, installed: [], skipped: [], failed: [] };

  if (opts.uninstall) {
    uninstall({ say, note, ok, warn, opts });
    return;
  }

  // Determine which providers to install
  let selected;
  if (opts.only.length) {
    selected = PROVIDERS.filter(p => opts.only.includes(p.id));
  } else if (opts.all) {
    selected = PROVIDERS.filter(p => detectMatch(p.detect));
  } else if (opts.minimal) {
    selected = PROVIDERS.filter(p => !p.soft && detectMatch(p.detect));
  } else {
    // Default: auto-detect non-soft providers
    selected = PROVIDERS.filter(p => !p.soft && detectMatch(p.detect));
  }

  // Interactive TTY prompt
  if (!opts.nonInteractive && !opts.only.length && !opts.all && !opts.minimal) {
    const ids = await promptForOnly(selected);
    if (ids) selected = PROVIDERS.filter(p => ids.includes(p.id));
  }

  if (selected.length === 0) {
    say('No agents detected. Use --only <id> to select manually or --list to see options.');
    return;
  }

  say(chalk.orange('⚡ ansible-copilot install') + ` (${selected.length} agent(s) detected)`);
  say('');

  for (const p of selected) {
    p.install({ say, note, ok, warn, opts, repoRoot: root, results, prov: p });
  }

  if (opts.withInit) {
    say('→ Per-repo rules (--with-init)');
    runInit({ say, note, warn, opts, repoRoot: root });
    say('');
    results.installed.push('per-repo-rules');
  }

  // Summary
  say(chalk.dim('─'.repeat(40)));
  const totalOk = results.installed.length;
  const totalSkip = results.skipped.length;
  const totalFail = results.failed.length;
  const summaryColor = totalFail > 0 ? chalk.yellow : chalk.green;
  say(summaryColor(`✓ ${totalOk} installed, ${totalSkip} skipped, ${totalFail} failed`));
  if (results.skipped.length) {
    for (const [id, reason] of results.skipped) {
      note(`- ${id}: ${reason}`);
    }
  }
  if (results.failed.length) {
    for (const [id, reason] of results.failed) {
      warn(`✗ ${id}: ${reason}`);
    }
  }
  say('');
  say('Done. Prerequisites: uv + Python 3.12+.\n  Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh');
}

// ── Wire per-provider install functions ────────────────────────────────────
PROVIDERS[0].install = installOpencode;
PROVIDERS[1].install = installClaude;
PROVIDERS[2].install = installGemini;
PROVIDERS[3].install = installViaInit;
PROVIDERS[4].install = installViaInit;

main().catch(e => { process.stderr.write(e.stack + '\n'); process.exit(1); });
