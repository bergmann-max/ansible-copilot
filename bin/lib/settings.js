'use strict';

const fs = require('fs');

function readSettings(filepath) {
  if (!fs.existsSync(filepath)) return {};
  try {
    const raw = fs.readFileSync(filepath, 'utf8');
    return parseJSONC(raw);
  } catch (_) {
    return null;
  }
}

function writeSettings(filepath, obj) {
  fs.mkdirSync(require('path').dirname(filepath), { recursive: true });
  const tmp = filepath + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, filepath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
    throw err;
  }
}

function parseJSONC(text) {
  // Phase 1: strip comments (// and /* */)
  let stripped = '';
  let i = 0;
  let inString = false;

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (inString) {
      stripped += c;
      if (c === '\\') { stripped += next || ''; i += 2; continue; }
      if (c === '"') inString = false;
      i++;
      continue;
    }

    // Single-line comment
    if (c === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      if (i < text.length) { stripped += '\n'; i++; }
      continue;
    }

    // Multi-line comment
    if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') stripped += '\n';
        i++;
      }
      i += 2;
      continue;
    }

    if (c === '"') inString = true;
    stripped += c;
    i++;
  }

  // Phase 2: strip trailing commas
  let result = '';
  inString = false;
  for (i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === '"' && (i === 0 || stripped[i - 1] !== '\\')) {
      inString = !inString;
      result += c;
      continue;
    }
    if (!inString && c === ',') {
      // Look ahead for next non-whitespace char
      let j = i + 1;
      while (j < stripped.length && (stripped[j] === ' ' || stripped[j] === '\t' || stripped[j] === '\n' || stripped[j] === '\r')) j++;
      if (j < stripped.length && (stripped[j] === '}' || stripped[j] === ']')) {
        // Trailing comma — skip it, but preserve whitespace
        while (i + 1 < stripped.length && (stripped[i + 1] === ' ' || stripped[i + 1] === '\t' || stripped[i + 1] === '\n' || stripped[i + 1] === '\r')) {
          result += stripped[++i];
        }
        continue;
      }
    }
    result += c;
  }

  return JSON.parse(result);
}

module.exports = { readSettings, writeSettings, parseJSONC };
