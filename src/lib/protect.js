// Wraps a user's script with a runtime whitelist check, so the uploaded script
// only runs after the bot's validation API confirms the key + HWID.
//
// The check is embedded without the API token — the validation endpoint is
// public but rate-limited (see api.js), so a leaked script still can't run on
// a different device (HWID mismatch).
import { CONFIG } from './config.js';

function luaEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

// Returns the protected Luau source for a script (or throws if not found).
export function protectSource(source, { script, key, hwid, endpoint }) {
  const endpointClean = endpoint || CONFIG.publicUrl || `http://localhost:${CONFIG.apiPort}`;

  const preamble = `--[[
  ┌─────────────────────────────────────────────┐
  │  PROTECT-VMAX — Whitelist Locked             │
  │  Script : ${String(script)}
  │  Owner  : ${CONFIG.creditName}
  │  Do not remove this block.                   │
  └─────────────────────────────────────────────┘
]]

local __V = {
  endpoint = "${luaEscape(endpointClean)}",
  key      = "${luaEscape(key || '')}",
  hwid     = "${luaEscape(hwid || '')}",
  script   = "${luaEscape(script || '')}",
}

local function __V_hwid()
  if type(__V.hwid) == "string" and __V.hwid ~= "" then
    return __V.hwid
  end
  local candidates = {}
  if type(gethwid) == "function" then table.insert(candidates, gethwid) end
  if type(get_hwid) == "function" then table.insert(candidates, get_hwid) end
  if type(syn) == "table" and type(syn.get_hwid) == "function" then
    table.insert(candidates, syn.get_hwid)
  end
  table.insert(candidates, function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
  end)
  for _, fn in ipairs(candidates) do
    local ok, id = pcall(fn)
    if ok and id and tostring(id) ~= "" then
      return tostring(id)
    end
  end
  error("[Protect-Vmax] Could not read device ID (HWID).", 2)
end

-- Whitelist check — call the Protect-Vmax API before anything else runs.
local __V_check = function()
  local hwid = __V_hwid()
  local url = __V.endpoint .. "/api/v1/validate?key=" .. __V.key
        .. "&hwid=" .. hwid .. "&script=" .. __V.script
  local ok, res
  if (request) then
    ok, res = pcall(request, { Url = url, Method = "GET" })
  elseif (game and game.GetService and game:GetService("HttpService")) then
    ok, res = pcall(game:GetService("HttpService").HttpGet, game:GetService("HttpService"), url, true)
  else
    error("[Protect-Vmax] No HTTP library found — use an executor with request() or HttpService.", 2)
  end
  if not ok then
    error("[Protect-Vmax] Could not reach the license server.", 2)
  end
  if type(res) == "table" and res.StatusCode then
    if res.StatusCode == 200 then return true end
    error("[Protect-Vmax] " .. tostring(res.Body), 2)
  end
  if type(res) == "string" then
    local ok2, data = pcall(function() return game:GetService("HttpService"):JSONDecode(res) end)
    if ok2 and data.status == "valid" then return true end
    error("[Protect-Vmax] " .. tostring(res), 2)
  end
  error("[Protect-Vmax] License check failed.", 2)
end

__V_check()

-- Whitelist verified. Protected by ${CONFIG.creditName} (Protect-Vmax).
`;

  return preamble + source;
}

// Escape helper shared with future tools.
export { luaEscape };
