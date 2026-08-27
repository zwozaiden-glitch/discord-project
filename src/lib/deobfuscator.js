// Static Lua deobfuscator + obfuscator detector.
// Inspired by public pipelines (WeAreDevs tracer, IronBrew2, MoonSec V3,
// Luraph, lua-deobf-actions, ENV-Logger): detect first, then run the matching
// cleanup passes. VM-based protectors cannot be fully lifted in-process;
// we still extract strings, unwrap loadstring layers, and beautify.

export const OBFUSCATORS = [
  { id: 'auto', name: 'Auto-detect', description: 'Detect the obfuscator, then run the matching passes.' },
  { id: 'luraph', name: 'Luraph', description: 'Luraph / LPH wrappers (v14-style signatures).' },
  { id: 'ironbrew', name: 'IronBrew2', description: 'IronBrew2 / 25ms / AztupBrew-style VMs.' },
  { id: 'moonsec', name: 'MoonSec V2', description: 'MoonSec V2 wrapper + constant extraction.' },
  { id: 'moonsecv3', name: 'MoonSec V3', description: 'MoonSec V3 banner + bytecode blob extraction.' },
  { id: 'wearedevs', name: 'WeAreDevs', description: 'WeAreDevs / WRD string + loadstring wrappers.' },
  { id: 'prometheus', name: 'Prometheus', description: 'Prometheus / LPH! bytecode magic.' },
  { id: 'aztupbrew', name: 'AztupBrew', description: 'AztupBrew (IronBrew fork) signatures.' },
  { id: 'luaobfuscator', name: 'LuaObfuscator', description: 'luaobfuscator.com string.char / hex style.' },
  { id: 'generic', name: 'Generic', description: 'Constant folding, loadstring unwrap, beautify.' },
];

const SIGNATURES = [
  { id: 'moonsecv3', name: 'MoonSec V3', pattern: /This file was protected with MoonSec V3/i, weight: 100 },
  { id: 'moonsec', name: 'MoonSec V2', pattern: /\.\.:::MoonSec::\.\./i, weight: 95 },
  { id: 'moonsec', name: 'MoonSec', pattern: /MOONSEC|_MOONSEC_/i, weight: 70 },
  { id: 'ironbrew', name: 'IronBrew2 / 25ms', pattern: /ironbrew|\[\[25ms\]\]|gCtfkH/i, weight: 95 },
  { id: 'ironbrew', name: 'IronBrew2 VM', pattern: /return\s*\(\s*function\s*\(\s*[\w,.\s]*\)\s*.{0,200}GetFenv/is, weight: 55 },
  { id: 'aztupbrew', name: 'AztupBrew', pattern: /AztupBrew/i, weight: 95 },
  { id: 'luraph', name: 'Luraph', pattern: /Luraph\s*(Obfuscator|v\d+)|LPH[_!]/i, weight: 95 },
  { id: 'prometheus', name: 'Prometheus', pattern: /prometheus|PrometheusBytecodeMagic|LPH!/i, weight: 80 },
  { id: 'wearedevs', name: 'WeAreDevs', pattern: /wearedevs|WRD[-_ ]?(?:obfuscat|protect)|getgenv\(\)\s*\[\s*["']wrd/i, weight: 90 },
  { id: 'luaobfuscator', name: 'LuaObfuscator', pattern: /luaobfuscator\.com|LuaObfuscator/i, weight: 90 },
  { id: 'luaobfuscator', name: 'string.char pack', pattern: /string\.char\s*\(\s*\d{1,3}\s*(,\s*\d{1,3}\s*){8,}/i, weight: 40 },
];

const VM_IDS = new Set(['luraph', 'ironbrew', 'moonsec', 'moonsecv3', 'prometheus', 'aztupbrew']);

const COMPOUND = [
  ['+=', '+'],
  ['-=', '-'],
  ['*=', '*'],
  ['/=', '/'],
  ['%=', '%'],
  ['..=', '..'],
];

export function detectObfuscator(source) {
  const text = String(source || '');
  const hits = [];
  for (const sig of SIGNATURES) {
    const match = text.match(sig.pattern);
    if (!match) continue;
    hits.push({
      id: sig.id,
      name: sig.name,
      confidence: sig.weight,
      evidence: String(match[0]).slice(0, 80),
    });
  }

  hits.sort((a, b) => b.confidence - a.confidence);
  const best = hits[0] || null;
  return {
    best,
    hits,
    unknown: !best,
    recommendation: best
      ? `Run the ${best.name} pipeline (or pick it with obfuscator:).`
      : 'No known obfuscator banner. Use generic cleanup / constant folding.',
  };
}

function decodeCharCodes(list) {
  const parts = [];
  for (const raw of list.split(',')) {
    const n = Number(String(raw).trim());
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    parts.push(n);
  }
  if (!parts.length) return null;
  return Buffer.from(parts).toString('latin1');
}

function luaStringLiteral(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;
}

function foldStringChar(src) {
  return src.replace(/string\.char\s*\(([^)]{1,800})\)/gi, (all, inner) => {
    if (!/^[\s0-9xXa-fA-F,]+$/.test(inner)) return all;
    const normalized = inner.replace(/0x([0-9a-fA-F]+)/g, (_, h) => String(parseInt(h, 16)));
    const decoded = decodeCharCodes(normalized);
    if (decoded == null || decoded.length < 1) return all;
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(decoded) && decoded.length > 4) return all;
    return luaStringLiteral(decoded);
  });
}

function foldHexEscapes(src) {
  return src.replace(/["']((?:\\x[0-9a-fA-F]{2}){4,})["']/g, (all, body) => {
    const bytes = [];
    const re = /\\x([0-9a-fA-F]{2})/g;
    let m;
    while ((m = re.exec(body))) bytes.push(parseInt(m[1], 16));
    const decoded = Buffer.from(bytes).toString('latin1');
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(decoded)) return all;
    return luaStringLiteral(decoded);
  });
}

function foldDecimalEscapes(src) {
  return src.replace(/["']((?:\\\d{1,3}){4,})["']/g, (all, body) => {
    const bytes = [];
    const re = /\\(\d{1,3})/g;
    let m;
    while ((m = re.exec(body))) {
      const n = Number(m[1]);
      if (n > 255) return all;
      bytes.push(n);
    }
    const decoded = Buffer.from(bytes).toString('latin1');
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(decoded)) return all;
    return luaStringLiteral(decoded);
  });
}

function foldConcat(src) {
  let out = src;
  for (let i = 0; i < 8; i += 1) {
    const next = out.replace(/(["'])((?:\\.|[^\\])*?)\1\s*\.\.\s*(["'])((?:\\.|[^\\])*?)\3/g, (_, q1, a, q2, b) => {
      void q1;
      void q2;
      return luaStringLiteral(a.replace(/\\'/g, "'") + b.replace(/\\'/g, "'"));
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

function foldReverse(src) {
  return src.replace(/string\.reverse\s*\(\s*(["'])((?:\\.|[^\\])*?)\1\s*\)/gi, (all, q, body) => {
    void q;
    try {
      return luaStringLiteral([...body].reverse().join(''));
    } catch {
      return all;
    }
  });
}

function decodeBase64Chunks(src) {
  return src.replace(/(["'])([A-Za-z0-9+/]{40,}={0,2})\1/g, (all, q, b64) => {
    void q;
    if (b64.length % 4 === 1) return all;
    try {
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      if (!decoded || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(decoded)) return all;
      if (!/[A-Za-z_]/.test(decoded)) return all;
      if (decoded.length < 8) return all;
      return luaStringLiteral(decoded);
    } catch {
      return all;
    }
  });
}

function unwrapLoadstring(src) {
  return src.replace(
    /\b(?:loadstring|load)\s*\(\s*(["'])((?:\\.|[^\\])*?)\1\s*\)\s*\(\s*\)/gi,
    (_, q, body) => {
      void q;
      return body.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\'/g, "'").replace(/\\"/g, '"');
    },
  );
}

function stripComments(src) {
  let out = src.replace(/--\[\[[\s\S]*?\]\]/g, '');
  out = out.replace(/--[^\n]*/g, '');
  return out;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expandCompound(src) {
  let out = src;
  for (const [op, plain] of COMPOUND) {
    const re = new RegExp(`(\\w+)\\s*${escapeRegExp(op)}\\s*([^;\\n]+)`, 'g');
    out = out.replace(re, (_, name, expr) => `${name} = ${name} ${plain} ${expr.trim()}`);
  }
  return out;
}

function collapseParens(src) {
  return src.replace(/\(\(([^()\n]{1,80})\)\)/g, '($1)');
}

function extractUrls(src) {
  const urls = src.match(/https?:\/\/[^\s"'`]+/gi) || [];
  return [...new Set(urls.map((u) => u.replace(/[),.;]+$/, '')))].slice(0, 30);
}

function extractInterestingStrings(src) {
  const found = [];
  const re = /(["'])((?:\\.|[^\\])*?)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const s = m[2];
    if (s.length >= 12 && /(?:http|loadstring|getgenv|game:|workspace|HttpGet|discord)/i.test(s)) {
      found.push(s.slice(0, 240));
    }
    if (found.length >= 40) break;
  }
  return [...new Set(found)];
}

function extractBytecodeBlobs(src) {
  const blobs = [];
  if (src.includes('\x1bLua') || src.includes('\\27Lua') || /\\x1bLua/.test(src)) {
    blobs.push('Lua bytecode header detected (\\x1bLua).');
  }
  const long = src.match(/\[\[([\s\S]{200,})\]\]/g) || [];
  for (const block of long.slice(0, 5)) {
    if (/[\x00-\x08]/.test(block) || block.includes('\x1b')) {
      blobs.push(`Long bracket blob (${block.length} chars) — possible VM dump.`);
    }
  }
  return blobs;
}

function beautify(src) {
  const lines = src.replace(/\r\n/g, '\n').replace(/;(?=\s*\n)/g, '').split('\n');
  let indent = 0;
  const out = [];
  for (let raw of lines) {
    let line = raw.trim();
    if (!line) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    const opens = (line.match(/\b(function|then|do|repeat)\b/g) || []).length;
    const closes = (line.match(/\bend\b|\buntil\b/g) || []).length;
    const elseLike = /^(else|elseif)\b/.test(line);
    if (closes && !opens) indent = Math.max(0, indent - closes);
    if (elseLike) indent = Math.max(0, indent - 1);
    out.push(`${'    '.repeat(indent)}${line}`);
    if (elseLike) indent += 1;
    indent = Math.max(0, indent + opens - (elseLike ? 0 : closes));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function wearedevsPass(src) {
  let out = src;
  out = out.replace(/getfenv\s*\(\s*\)\s*\[\s*string\.reverse\s*\(\s*(["'])((?:\\.|[^\\])*?)\1\s*\)\s*\]/gi, (_, q, body) => {
    void q;
    const name = [...body].reverse().join('');
    return name;
  });
  out = foldReverse(out);
  out = foldStringChar(out);
  return out;
}

function ironbrewPass(src) {
  let out = src;
  out = out.replace(/GetFenv/g, 'getfenv');
  const consts = [];
  const tableRe = /\{(\s*\d+\s*(,\s*\d+\s*){16,})\}/g;
  let m;
  while ((m = tableRe.exec(src))) {
    const decoded = decodeCharCodes(m[1]);
    if (decoded && /[A-Za-z]{4,}/.test(decoded) && !/[\x00-\x08]/.test(decoded)) {
      consts.push(decoded.slice(0, 400));
    }
  }
  if (consts.length) {
    out += `\n\n-- [IronBrew] extracted numeric-table strings:\n${consts
      .slice(0, 20)
      .map((s, i) => `-- ${i + 1}: ${luaStringLiteral(s)}`)
      .join('\n')}\n`;
  }
  return out;
}

function luraphPass(src) {
  let out = src;
  const lph = src.match(/LPH[_!][\w]*/g) || [];
  if (lph.length) {
    out += `\n\n-- [Luraph] symbols: ${[...new Set(lph)].slice(0, 40).join(', ')}\n`;
  }
  return out;
}

function moonsecPass(src) {
  let out = src;
  const banner = src.match(/This file was protected with MoonSec V3[^\n]*/i);
  if (banner) out = `-- Detected: ${banner[0]}\n${out}`;
  return out;
}

function genericPasses(src, { keepComments = false } = {}) {
  let out = src;
  if (!keepComments) out = stripComments(out);
  out = foldHexEscapes(out);
  out = foldDecimalEscapes(out);
  out = foldStringChar(out);
  out = foldReverse(out);
  out = decodeBase64Chunks(out);
  out = foldConcat(out);
  out = unwrapLoadstring(out);
  out = expandCompound(out);
  out = collapseParens(out);
  out = beautify(out);
  return out;
}

export function deobfuscate(source, obfuscatorId = 'auto') {
  const input = String(source || '');
  const detection = detectObfuscator(input);
  const chosen =
    obfuscatorId && obfuscatorId !== 'auto'
      ? obfuscatorId
      : detection.best?.id || 'generic';

  let output = input;
  const notes = [];

  if (chosen === 'wearedevs') {
    output = wearedevsPass(output);
    notes.push('WeAreDevs: reversed getfenv keys, string.char / reverse folding.');
  } else if (chosen === 'ironbrew' || chosen === 'aztupbrew') {
    output = ironbrewPass(output);
    notes.push('IronBrew2/AztupBrew: numeric constant tables extracted when printable.');
  } else if (chosen === 'luraph' || chosen === 'prometheus') {
    output = luraphPass(output);
    notes.push('Luraph/Prometheus: symbol harvest + generic unwrap. Full VM lift is not in-process.');
  } else if (chosen === 'moonsec' || chosen === 'moonsecv3') {
    output = moonsecPass(output);
    notes.push('MoonSec: banner/bytecode notes + generic unwrap. Native unluac-style lift is not bundled.');
  } else if (chosen === 'luaobfuscator') {
    notes.push('LuaObfuscator: heavy string.char / hex folding.');
  } else {
    notes.push('Generic constant folding, loadstring unwrap, beautify.');
  }

  output = genericPasses(output, { keepComments: chosen === 'moonsec' || chosen === 'moonsecv3' });

  if (VM_IDS.has(chosen)) {
    notes.push(
      'This obfuscator uses a VM. Static cleanup cannot reconstruct original source the way a dedicated lifter (unluac / IB2 reserializer / Luraph dump) can — constants, URLs, and wrappers are still recovered.',
    );
  }

  const findings = {
    urls: extractUrls(output + '\n' + input),
    strings: extractInterestingStrings(output),
    bytecode: extractBytecodeBlobs(input),
  };

  if (!output.trim()) output = input;

  return {
    obfuscator: chosen,
    detection,
    output,
    notes,
    findings,
    stats: {
      inputBytes: Buffer.byteLength(input),
      outputBytes: Buffer.byteLength(output),
      reduced: Buffer.byteLength(input) - Buffer.byteLength(output),
    },
  };
}

export function envLoggerSource() {
  return `-- Protect-Vmax ENV logger
-- Run this in your executor to dump a script's environment (getsenv).
-- Inspired by public ENV dumpers: functions, values, tables, userdata, upvalues.

local flags = (getgenv and getgenv().Flags) or {
    ["only-functions"] = false,
    ["only-values"] = false,
    ["no-functions"] = false,
    ["no-tables"] = false,
    ["no-userdata"] = false,
    ["no-upvalues"] = false,
    ["no-writing"] = false,
    ["no-printing"] = false,
}

local target = (getgenv and getgenv().FilePath) or nil
if typeof(target) ~= "Instance" then
    error("[ENV-Logger] Set getgenv().FilePath to a Script/LocalScript Instance first.", 0)
end
if type(getsenv) ~= "function" then
    error("[ENV-Logger] This executor does not support getsenv.", 0)
end

local output, visited = {}, {}

local function write(line)
    table.insert(output, line)
end

local function allowed(t)
    if flags["only-functions"] then return t == "function" end
    if flags["only-values"] then return t ~= "function" and t ~= "table" and t ~= "userdata" end
    if t == "function" and flags["no-functions"] then return false end
    if t == "table" and flags["no-tables"] then return false end
    if t == "userdata" and flags["no-userdata"] then return false end
    return true
end

local function safe(value)
    local ok, text = pcall(tostring, value)
    return ok and text or "<unprintable>"
end

local function dump(tbl, prefix)
    if visited[tbl] then
        write(prefix .. " = <visited>")
        return
    end
    visited[tbl] = true

    local functions, values, tables, userdata, upvalues = {}, {}, {}, {}, {}

    for key, value in pairs(tbl) do
        local path = prefix ~= "" and (prefix .. "." .. tostring(key)) or tostring(key)
        local t = typeof(value)
        if t == "table" then
            if allowed(t) then tables[path] = value end
            if not flags["no-tables"] and not flags["only-functions"] and not flags["only-values"] then
                dump(value, path)
            end
        elseif t == "function" then
            if allowed(t) then
                functions[path] = value
                if not flags["no-upvalues"] and debug and debug.getupvalue then
                    local i = 1
                    while true do
                        local ok, name, val = pcall(debug.getupvalue, value, i)
                        if not ok or not name then break end
                        table.insert(upvalues, path .. "." .. safe(name) .. " = " .. (val == nil and "<nil>" or safe(val)))
                        i += 1
                    end
                end
            end
        elseif t == "userdata" then
            if allowed(t) then userdata[path] = value end
        else
            if allowed(t) then values[path] = value end
        end
    end

    if next(functions) then
        write("-- FUNCTIONS --")
        for path, fn in pairs(functions) do
            write(path .. " = function " .. path .. "(...) " .. safe(fn))
        end
    end
    if next(values) then
        write("-- VALUES --")
        for path, val in pairs(values) do
            write(path .. " = " .. safe(val))
        end
    end
    if next(tables) then
        write("-- TABLES --")
        for path in pairs(tables) do
            write(path .. " = table")
        end
    end
    if next(userdata) then
        write("-- USERDATA --")
        for path, val in pairs(userdata) do
            write(path .. " = userdata " .. safe(val))
        end
    end
    if next(upvalues) then
        write("-- UPVALUES --")
        for _, line in ipairs(upvalues) do
            write(line)
        end
    end
end

local env = getsenv(target)
write("-- " .. target.Name .. " ENV DUMP")
dump(env, "")
local result = table.concat(output, "\\n")

if not flags["no-printing"] then
    print(result)
end
if not flags["no-writing"] and writefile then
    writefile(target.Name .. ".env.txt", result)
end
print("[ENV-Logger] dumped " .. target.Name)
`;
}
