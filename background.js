const POLL_INTERVAL_MS = 10000;

let statusPollTimer = null;
let authPollTimer = null;

// --- Settings ---

const SETTINGS_DEFAULTS = {
  proxyHost: "localhost",
  proxyPort: 1080,
  apiUrl: "",
};

let settings = { ...SETTINGS_DEFAULTS };

async function loadSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_DEFAULTS);
  settings = {
    proxyHost: data.proxyHost || SETTINGS_DEFAULTS.proxyHost,
    proxyPort: parseInt(data.proxyPort, 10) || SETTINGS_DEFAULTS.proxyPort,
    apiUrl: (data.apiUrl || "").replace(/\/+$/, ""), // strip trailing slashes
  };
  return settings;
}

function getSocksString() {
  return `SOCKS5 ${settings.proxyHost}:${settings.proxyPort}`;
}

function hasApi() {
  return settings.apiUrl.length > 0;
}

// Reload settings when changed in options page
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    loadSettings().then(() => {
      // Re-apply proxy with new settings if currently active
      getState().then((state) => {
        if (state.proxyEnabled && (hasApi() ? state.connected : true)) {
          applyProxy();
        }
      });
    });
  }
});

// --- State ---

async function getState() {
  const defaults = {
    connected: false,
    proxyMode: "all", // "all" | "pertab"
    routedDomains: [],
    proxyEnabled: false,
  };
  const data = await chrome.storage.local.get(defaults);
  return data;
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

// --- PAC Script ---

function buildPacScript(mode, domains) {
  const socks = getSocksString();
  if (mode === "all") {
    return `function FindProxyForURL(url, host) { return "${socks}"; }`;
  }
  const conditions = domains
    .map((d) => `dnsDomainIs(host, "${d}") || host === "${d}"`)
    .join(" || ");
  if (!conditions) {
    return `function FindProxyForURL(url, host) { return "DIRECT"; }`;
  }
  return `function FindProxyForURL(url, host) {
  if (${conditions}) {
    return "${socks}";
  }
  return "DIRECT";
}`;
}

async function applyProxy() {
  const state = await getState();
  // When API is configured, require connected state. Without API, proxy is standalone.
  const canProxy = hasApi() ? state.connected && state.proxyEnabled : state.proxyEnabled;
  if (!canProxy) {
    await chrome.proxy.settings.clear({ scope: "regular" });
    return;
  }
  const pac = buildPacScript(state.proxyMode, state.routedDomains);
  await chrome.proxy.settings.set({
    value: { mode: "pac_script", pacScript: { data: pac } },
    scope: "regular",
  });
}

async function disableProxy() {
  await setState({ proxyEnabled: false });
  await chrome.proxy.settings.clear({ scope: "regular" });
}

// --- Icon / Badge ---

async function updateIcon() {
  const state = await getState();
  const isActive = hasApi() ? state.connected : true;

  if (!isActive) {
    await setIconColor("gray");
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  if (state.proxyMode === "all" && state.proxyEnabled) {
    await setIconColor("green");
    await chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
    await chrome.action.setBadgeText({ text: "ON" });
  } else if (state.proxyMode === "pertab" && state.proxyEnabled) {
    await setIconColor("blue");
    const count = state.routedDomains.length;
    await chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "0" });
  } else {
    await setIconColor("gray");
    await chrome.action.setBadgeText({ text: "" });
  }
}

async function setIconColor(color) {
  const sizes = [16, 48, 128];
  const imageData = {};
  for (const size of sizes) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    const colors = {
      gray: "#6b7280",
      green: "#22c55e",
      blue: "#3b82f6",
    };
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = colors[color] || colors.gray;
    ctx.fill();

    // Draw a "P" in the center for Proxy
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, size / 8);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    const cx = size / 2;
    const cy = size / 2;
    const s = size * 0.2;
    ctx.moveTo(cx - s, cy + s * 0.7);
    ctx.lineTo(cx - s, cy - s * 0.7);
    ctx.lineTo(cx + s * 0.3, cy - s * 0.7);
    ctx.quadraticCurveTo(cx + s, cy - s * 0.7, cx + s, cy - s * 0.1);
    ctx.quadraticCurveTo(cx + s, cy + s * 0.5, cx + s * 0.3, cy + s * 0.1);
    ctx.lineTo(cx - s, cy + s * 0.1);
    ctx.stroke();

    imageData[size] = ctx.getImageData(0, 0, size, size);
  }
  await chrome.action.setIcon({ imageData });
}

// --- API calls ---

async function apiCall(method, path) {
  if (!hasApi()) return null;
  try {
    const resp = await fetch(`${settings.apiUrl}${path}`, { method });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.error(`API ${method} ${path} failed:`, e);
    return null;
  }
}

async function checkStatus() {
  if (!hasApi()) {
    // No API configured. Nothing to poll.
    return null;
  }
  const result = await apiCall("GET", "/status");
  if (!result) {
    // API unreachable, assume disconnected
    const state = await getState();
    if (state.connected) {
      await setState({ connected: false });
      await disableProxy();
      await updateIcon();
    }
    return null;
  }
  const wasConnected = (await getState()).connected;
  const isConnected = result.connected === true;

  if (wasConnected && !isConnected) {
    await setState({ connected: false });
    await disableProxy();
    await updateIcon();
  } else if (!wasConnected && isConnected) {
    await setState({ connected: true });
    await updateIcon();
  }
  return result;
}

// --- Connect / Disconnect ---

async function connect() {
  if (!hasApi()) return { error: "No API URL configured" };

  const result = await apiCall("POST", "/connect");
  if (!result) return { error: "API unreachable" };

  if (result.auth_url) {
    // Open auth URL
    chrome.tabs.create({ url: result.auth_url });
    // Start polling for connection
    return { status: "authenticating" };
  }

  if (result.connected) {
    await setState({ connected: true, proxyEnabled: true });
    await applyProxy();
    await updateIcon();
    return { status: "connected" };
  }

  return { error: result.error || "unknown" };
}

async function disconnect() {
  if (!hasApi()) return { error: "No API URL configured" };

  const result = await apiCall("POST", "/disconnect");
  await setState({ connected: false });
  await disableProxy();
  await updateIcon();
  return result || { status: "disconnected" };
}

// --- Auth polling (called from popup during authentication) ---

function startAuthPoll() {
  stopAuthPoll();
  authPollTimer = setInterval(async () => {
    const result = await checkStatus();
    if (result && result.connected === true) {
      stopAuthPoll();
      await setState({ connected: true, proxyEnabled: true });
      await applyProxy();
      await updateIcon();
    }
  }, 2000);
}

function stopAuthPoll() {
  if (authPollTimer) {
    clearInterval(authPollTimer);
    authPollTimer = null;
  }
}

// --- Status polling ---

function startStatusPoll() {
  stopStatusPoll();
  if (!hasApi()) return; // No API, no polling needed
  statusPollTimer = setInterval(checkStatus, POLL_INTERVAL_MS);
}

function stopStatusPoll() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
}

// --- Context menus ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "route-tab",
    title: "Route this tab through proxy",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: "unroute-tab",
    title: "Stop routing this tab",
    contexts: ["page"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.url) return;
  let hostname;
  try {
    hostname = new URL(tab.url).hostname;
  } catch {
    return;
  }
  if (!hostname) return;

  const state = await getState();

  if (info.menuItemId === "route-tab") {
    const domains = state.routedDomains.includes(hostname)
      ? state.routedDomains
      : [...state.routedDomains, hostname];
    await setState({ routedDomains: domains, proxyMode: "pertab" });
    const canEnable = hasApi() ? state.connected : true;
    if (canEnable) {
      await setState({ proxyEnabled: true });
      await applyProxy();
    }
    await updateIcon();
  } else if (info.menuItemId === "unroute-tab") {
    const domains = state.routedDomains.filter((d) => d !== hostname);
    await setState({ routedDomains: domains });
    const canProxy = hasApi() ? state.connected && state.proxyEnabled : state.proxyEnabled;
    if (canProxy) {
      await applyProxy();
    }
    await updateIcon();
  }
});

// --- Message handler (from popup) ---

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.action) {
      case "connect": {
        const result = await connect();
        if (result.status === "authenticating") {
          startAuthPoll();
        }
        sendResponse(result);
        break;
      }
      case "disconnect": {
        const result = await disconnect();
        stopAuthPoll();
        sendResponse(result);
        break;
      }
      case "getState": {
        const state = await getState();
        sendResponse(state);
        break;
      }
      case "getSettings": {
        sendResponse({ ...settings });
        break;
      }
      case "setMode": {
        await setState({ proxyMode: msg.mode });
        const state = await getState();
        const canProxy = hasApi() ? state.connected && state.proxyEnabled : state.proxyEnabled;
        if (canProxy) {
          await applyProxy();
        }
        await updateIcon();
        sendResponse({ ok: true });
        break;
      }
      case "removeDomain": {
        const state = await getState();
        const domains = state.routedDomains.filter((d) => d !== msg.domain);
        await setState({ routedDomains: domains });
        const canProxy = hasApi() ? state.connected && state.proxyEnabled : state.proxyEnabled;
        if (canProxy) {
          await applyProxy();
        }
        await updateIcon();
        sendResponse({ ok: true });
        break;
      }
      case "toggleProxy": {
        const state = await getState();
        const canToggle = hasApi() ? state.connected : true;
        if (canToggle) {
          const newEnabled = !state.proxyEnabled;
          await setState({ proxyEnabled: newEnabled });
          if (newEnabled) {
            await applyProxy();
          } else {
            await chrome.proxy.settings.clear({ scope: "regular" });
          }
          await updateIcon();
        }
        sendResponse({ ok: true });
        break;
      }
      case "checkStatus": {
        const result = await checkStatus();
        sendResponse(result);
        break;
      }
      default:
        sendResponse({ error: "unknown action" });
    }
  })();
  return true; // keep channel open for async response
});

// --- Init ---

(async () => {
  await loadSettings();
  await updateIcon();
  startStatusPoll();
})();
