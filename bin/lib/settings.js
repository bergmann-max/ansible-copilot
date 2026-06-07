'use strict';

const fs = require('fs');
const path = require('path');

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
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const tmp = filepath + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, filepath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

/**
 * Patch JSONC file: set or remove nested keys, preserving existing formatting.
 * Uses text-based patching for depth ≤ 2; falls back to parse-modify-write for deeper paths.
 * @param {string} filepath
 * @param {object} patches - { "path.to.key": value }
 * @param {string[]} removals - ["path.to.key"]
 */
function patchSettings(filepath, patches, removals) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });

  if (!fs.existsSync(filepath)) {
    const obj = {};
    for (const [k, v] of Object.entries(patches || {})) {
      setNestedOnObj(obj, k.split('.'), v);
    }
    writeSettings(filepath, obj);
    return;
  }

  let raw = fs.readFileSync(filepath, 'utf8');

  // Remove keys first
  for (const dottedPath of (removals || [])) {
    raw = removeKey(raw, dottedPath.split('.'));
  }

  // Set keys
  for (const [dottedPath, value] of Object.entries(patches || {})) {
    raw = setKey(raw, dottedPath.split('.'), JSON.stringify(value, null, 2));
  }

  // Deduplicate final newlines
  raw = raw.replace(/\n{3,}/g, '\n\n');

  const tmp = filepath + '.tmp';
  try {
    fs.writeFileSync(tmp, raw, { mode: 0o600 });
    fs.renameSync(tmp, filepath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function setNestedOnObj(obj, keys, value) {
  let target = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!target[keys[i]] || typeof target[keys[i]] !== 'object') target[keys[i]] = {};
    target = target[keys[i]];
  }
  target[keys[keys.length - 1]] = value;
}

// ── text-based JSONC patching ───────────────────────────────────────────────

function scanValue(text, start) {
  let i = start;
  let inString = false;
  let depth = 0;

  if (text[i] === '{' || text[i] === '[') {
    const open = text[i];
    const close = open === '{' ? '}' : ']';
    depth = 1;
    i++;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === '"' && text[i - 1] !== '\\') { inString = !inString; i++; continue; }
      if (inString) { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { i += 2; while (i < text.length && text[i] !== '\n') i++; continue; }
      if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
      if (c === open) depth++;
      if (c === close) depth--;
      i++;
    }
    return i;
  }

  if (text[i] === '"') {
    i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === '"') return i + 1;
      i++;
    }
    return i;
  }

  while (i < text.length && /[a-zA-Z0-9.\-+]/.test(text[i])) i++;
  return i;
}

/**
 * Find a top-level key in JSONC text and return its value range.
 * Returns { keyStart, keyEnd, valueStart, valueEnd } or null.
 */
function findTopLevelValue(text, keyName) {
  let i = 0;
  let inString = false;
  let depth = 0;

  while (i < text.length) {
    const c = text[i];

    if (c === '"' && text[i - 1] !== '\\') {
      inString = !inString;
      if (inString && depth === 1) {
        const keyStart = i;
        let j = i + 1;
        while (j < text.length) {
          if (text[j] === '\\') { j += 2; continue; }
          if (text[j] === '"') break;
          j++;
        }
        const candidate = text.slice(keyStart + 1, j);
        if (candidate === keyName) {
          let k = j + 1;
          while (k < text.length && (text[k] === ' ' || text[k] === '\t' || text[k] === '\n' || text[k] === '\r')) k++;
          if (text[k] === ':') {
            k++;
            while (k < text.length && (text[k] === ' ' || text[k] === '\t' || text[k] === '\n' || text[k] === '\r')) k++;
            return { keyStart, keyEnd: j + 1, valueStart: k, valueEnd: scanValue(text, k) };
          }
        }
        // Didn't match: skip past the closing quote, toggle inString back
        inString = false;
        i = j;
      }
      i++;
      continue;
    }

    if (inString) { i++; continue; }

    if (c === '/' && text[i + 1] === '/') { i += 2; while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }

    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') depth--;
    i++;
  }

  return null;
}

/**
 * Find a key inside an object value range (text after a parent key's opening brace).
 * text = the value content starting from '{', offset = its position in the full text.
 */
function findKeyInObjectRange(text, keyName, offset) {
  let i = 0;
  let inString = false;
  let depth = 0;

  while (i < text.length) {
    const c = text[i];

    if (c === '"' && text[i - 1] !== '\\') {
      inString = !inString;
      if (inString && depth === 1) {
        const keyStart = i;
        let j = i + 1;
        while (j < text.length) {
          if (text[j] === '\\') { j += 2; continue; }
          if (text[j] === '"') break;
          j++;
        }
        const candidate = text.slice(keyStart + 1, j);
        if (candidate === keyName) {
          let k = j + 1;
          while (k < text.length && (text[k] === ' ' || text[k] === '\t' || text[k] === '\n' || text[k] === '\r')) k++;
          if (text[k] === ':') {
            k++;
            while (k < text.length && (text[k] === ' ' || text[k] === '\t' || text[k] === '\n' || text[k] === '\r')) k++;
            return { keyStart: offset + keyStart, valueStart: offset + k, valueEnd: offset + scanValue(text, k) };
          }
        }
        inString = false;
        i = j;
      }
      i++;
      continue;
    }

    if (inString) { i++; continue; }
    if (c === '/' && text[i + 1] === '/') { i += 2; while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }

    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') depth--;
    i++;
  }

  return null;
}

function setKey(text, keys, valueJson) {
  if (keys.length === 0) return text;
  if (keys.length === 1) return setTopLevelKey(text, keys[0], valueJson);
  if (keys.length === 2) return setNestedKey(text, keys[0], keys[1], valueJson);
  // Deep nesting: fall back
  try {
    const obj = parseJSONC(text);
    setNestedOnObj(obj, keys, JSON.parse(valueJson));
    return JSON.stringify(obj, null, 2) + '\n';
  } catch (_) { return text; }
}

function setTopLevelKey(text, key, valueJson) {
  const existing = findTopLevelValue(text, key);
  if (existing) {
    return text.slice(0, existing.valueStart) + valueJson + text.slice(existing.valueEnd);
  }

  const closePos = findLastTopLevelBrace(text);
  if (closePos < 0) return text;

  const indent = guessIndent(text) || '  ';
  const beforeBrace = text.slice(0, closePos).trimEnd();
  const needsComma = beforeBrace.length > 0 && !beforeBrace.endsWith('{') && !beforeBrace.endsWith('[');
  const prefix = needsComma ? ',' : '';
  const indentedValue = valueJson.includes('\n') ? reindentJsonValue(valueJson, indent) : valueJson;
  const insertion = `${prefix}\n${indent}"${key}": ${indentedValue}\n`;

  return text.slice(0, closePos) + insertion + text.slice(closePos);
}

function setNestedKey(text, parentKey, childKey, valueJson) {
  const parent = findTopLevelValue(text, parentKey);
  if (!parent) {
    const indent = guessIndent(text) || '  ';
    const childIndent = indent + indent;
    const indentedValue = valueJson.includes('\n') ? reindentJsonValue(valueJson, childIndent) : valueJson;
    const parentObj = `{\n${childIndent}"${childKey}": ${indentedValue}\n${indent}}`;
    return setTopLevelKey(text, parentKey, parentObj);
  }

  const valText = text.slice(parent.valueStart, parent.valueEnd);
  if (!/^\s*\{/.test(valText)) {
    try {
      const obj = parseJSONC(text);
      setNestedOnObj(obj, [parentKey, childKey], JSON.parse(valueJson));
      return JSON.stringify(obj, null, 2) + '\n';
    } catch (_) { return text; }
  }

  const childRange = findKeyInObjectRange(valText, childKey, parent.valueStart);
  if (childRange) {
    return text.slice(0, childRange.valueStart) + valueJson + text.slice(childRange.valueEnd);
  }

  // Insert child before parent's closing brace
  let actualClose = parent.valueEnd - 1;
  while (actualClose > parent.valueStart && text[actualClose] !== '}') actualClose--;
  if (text[actualClose] !== '}') return text;

  const innerContent = text.slice(parent.valueStart + 1, actualClose).trim();
  const needsComma = innerContent.length > 0;
  const indent = guessIndent(text) || '  ';
  const childIndent = parentIndentContent(text, parent.valueStart) || (indent + indent);
  const comma = needsComma ? ',' : '';
  const indentedValue = valueJson.includes('\n') ? reindentJsonValue(valueJson, childIndent) : valueJson;
  const insertion = `${comma}\n${childIndent}"${childKey}": ${indentedValue}\n${indent}`;

  return text.slice(0, actualClose) + insertion + text.slice(actualClose);
}

function removeKey(text, keys) {
  if (keys.length === 0) return text;
  if (keys.length === 1) return removeTopLevelKey(text, keys[0]);
  if (keys.length === 2) return removeNestedKey(text, keys[0], keys[1]);
  try {
    const obj = parseJSONC(text);
    let target = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!target[keys[i]] || typeof target[keys[i]] !== 'object') return text;
      target = target[keys[i]];
    }
    delete target[keys[keys.length - 1]];
    return JSON.stringify(obj, null, 2) + '\n';
  } catch (_) { return text; }
}

function removeTopLevelKey(text, key) {
  const found = findTopLevelValue(text, key);
  if (!found) return text;

  let start = found.keyStart;
  let end = found.valueEnd;

  // Consume preceding comma + whitespace
  let before = start - 1;
  while (before >= 0 && (text[before] === ' ' || text[before] === '\t')) before--;
  if (before >= 0 && text[before] === ',') start = before;
  else {
    let after = end;
    while (after < text.length && (text[after] === ' ' || text[after] === '\t' || text[after] === '\n' || text[after] === '\r')) after++;
    if (after < text.length && text[after] === ',') end = after + 1;
  }

  // Remove preceding whitespace to previous newline
  let wsStart = start;
  while (wsStart > 0 && text[wsStart - 1] !== '\n') wsStart--;
  if (wsStart < start && text.slice(wsStart, start).trim() === '') start = wsStart;

  return text.slice(0, start) + text.slice(end);
}

function removeNestedKey(text, parentKey, childKey) {
  const parent = findTopLevelValue(text, parentKey);
  if (!parent) return text;

  const valText = text.slice(parent.valueStart, parent.valueEnd);
  if (!/^\s*\{/.test(valText)) return text;

  const child = findKeyInObjectRange(valText, childKey, parent.valueStart);
  if (!child) return text;

  let start = child.keyStart;
  let end = child.valueEnd;

  let before = start - 1;
  while (before > parent.valueStart && (text[before] === ' ' || text[before] === '\t')) before--;
  if (text[before] === ',') start = before;
  else {
    let after = end;
    while (after < text.length && (text[after] === ' ' || text[after] === '\t' || text[after] === '\n' || text[after] === '\r')) after++;
    if (after < text.length && text[after] === ',') end = after + 1;
  }

  let wsStart = start;
  while (wsStart > parent.valueStart && text[wsStart - 1] !== '\n') wsStart--;
  if (wsStart < start && text.slice(wsStart, start).trim() === '') start = wsStart;

  return text.slice(0, start) + text.slice(end);
}

function findLastTopLevelBrace(text) {
  let i = text.length - 1;
  let inString = false;
  let depth = 0;

  while (i >= 0) {
    const c = text[i];
    if (c === '"') {
      let escaped = false;
      let j = i - 1;
      while (j >= 0 && text[j] === '\\') { escaped = !escaped; j--; }
      if (!escaped) inString = !inString;
      i--;
      continue;
    }
    if (inString) { i--; continue; }
    if (c === '}' || c === ']') { depth++; if (depth === 1) return i; }
    if (c === '{' || c === '[') { depth--; if (depth < 0) return -1; }
    i--;
  }
  return -1;
}

function guessIndent(text) {
  const m = text.match(/\n([ \t]+)"/);
  return m ? m[1] : null;
}

function parentIndentContent(text, valueStart) {
  const content = text.slice(valueStart);
  const m = content.match(/\n([ \t]+)"/);
  return m ? m[1] : null;
}

function reindentJsonValue(valueJson, baseIndent) {
  if (!valueJson.includes('\n')) return valueJson;

  const lines = valueJson.split('\n');
  const innerIndent = guessIndent(valueJson) || '  ';
  const targetInner = baseIndent + innerIndent;

  return lines.map((line, i) => {
    if (i === 0) return line;
    const stripped = line.replace(/^[ \t]+/, '');
    if (stripped === '}' || stripped === ']') return baseIndent + stripped;
    return targetInner + stripped;
  }).join('\n');
}

// ── JSONC parser ────────────────────────────────────────────────────────────

function parseJSONC(text) {
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

    if (c === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      if (i < text.length) { stripped += '\n'; i++; }
      continue;
    }

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
      let j = i + 1;
      while (j < stripped.length && (stripped[j] === ' ' || stripped[j] === '\t' || stripped[j] === '\n' || stripped[j] === '\r')) j++;
      if (j < stripped.length && (stripped[j] === '}' || stripped[j] === ']')) {
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

module.exports = { readSettings, writeSettings, patchSettings, parseJSONC };
