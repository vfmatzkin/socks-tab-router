const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const statusDot = $("#status-dot");
const statusText = $("#status-text");
const connectSection = $("#connect-section");
const connectedSection = $("#connected-section");
const apiControls = $("#api-controls");
const btnConnect = $("#btn-connect");
const btnDisconnect = $("#btn-disconnect");
const btnToggleProxy = $("#btn-toggle-proxy");
const domainsSection = $("#domains-section");
const domainsList = $("#domains-list");
const domainsEmpty = $("#domains-empty");
const authMsg = $("#auth-msg");
const modeRadios = $$('input[name="mode"]');
const openSettings = $("#open-settings");

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

let hasApiUrl = false;

async function loadSettings() {
  const result = await send({ action: "getSettings" });
  hasApiUrl = result && result.apiUrl && result.apiUrl.length > 0;
}

async function refreshUI() {
  const state = await send({ action: "getState" });

  if (hasApiUrl) {
    // API mode: show connect/disconnect flow
    apiControls.classList.remove("hidden");

    if (state.connected) {
      statusDot.className = "dot dot-connected";
      statusText.textContent = "Connected";
      connectSection.classList.add("hidden");
      connectedSection.classList.remove("hidden");
      authMsg.classList.add("hidden");
    } else {
      statusDot.className = "dot dot-disconnected";
      statusText.textContent = "Disconnected";
      connectSection.classList.remove("hidden");
      connectedSection.classList.add("hidden");
    }
  } else {
    // No API: proxy-only mode, always show proxy controls
    apiControls.classList.add("hidden");
    connectSection.classList.add("hidden");
    connectedSection.classList.remove("hidden");
    authMsg.classList.add("hidden");

    if (state.proxyEnabled) {
      statusDot.className = "dot dot-connected";
      statusText.textContent = "Proxy Active";
    } else {
      statusDot.className = "dot dot-disconnected";
      statusText.textContent = "Proxy Inactive";
    }
  }

  // Proxy toggle button
  if (state.proxyEnabled) {
    btnToggleProxy.textContent = "Disable Proxy";
    btnToggleProxy.classList.add("active");
  } else {
    btnToggleProxy.textContent = "Enable Proxy";
    btnToggleProxy.classList.remove("active");
  }

  // Mode radios
  for (const radio of modeRadios) {
    radio.checked = radio.value === state.proxyMode;
  }

  // Domains section visibility
  if (state.proxyMode === "pertab") {
    domainsSection.classList.remove("hidden");
    renderDomains(state.routedDomains);
  } else {
    domainsSection.classList.add("hidden");
  }
}

function renderDomains(domains) {
  domainsList.innerHTML = "";
  if (domains.length === 0) {
    domainsEmpty.classList.remove("hidden");
    return;
  }
  domainsEmpty.classList.add("hidden");
  for (const domain of domains) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = domain;
    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.textContent = "\u00d7";
    btn.title = "Remove";
    btn.addEventListener("click", async () => {
      await send({ action: "removeDomain", domain });
      await refreshUI();
    });
    li.appendChild(span);
    li.appendChild(btn);
    domainsList.appendChild(li);
  }
}

// --- Event handlers ---

btnConnect.addEventListener("click", async () => {
  btnConnect.disabled = true;
  btnConnect.textContent = "Connecting...";

  const result = await send({ action: "connect" });

  if (result && result.status === "authenticating") {
    statusDot.className = "dot dot-authenticating";
    statusText.textContent = "Authenticating...";
    authMsg.classList.remove("hidden");
    connectSection.classList.add("hidden");
    // Poll until connected
    const poll = setInterval(async () => {
      const state = await send({ action: "getState" });
      if (state.connected) {
        clearInterval(poll);
        await refreshUI();
      }
    }, 2000);
  } else if (result && result.status === "connected") {
    await refreshUI();
  } else {
    btnConnect.disabled = false;
    btnConnect.textContent = "Connect";
    statusText.textContent = result?.error || "Connection failed";
  }
});

btnDisconnect.addEventListener("click", async () => {
  btnDisconnect.disabled = true;
  await send({ action: "disconnect" });
  btnDisconnect.disabled = false;
  await refreshUI();
});

btnToggleProxy.addEventListener("click", async () => {
  await send({ action: "toggleProxy" });
  await refreshUI();
});

for (const radio of modeRadios) {
  radio.addEventListener("change", async (e) => {
    await send({ action: "setMode", mode: e.target.value });
    await refreshUI();
  });
}

openSettings.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Listen for storage changes (from context menu actions in background, or settings changes)
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync") {
    await loadSettings();
  }
  await refreshUI();
});

// Init
(async () => {
  await loadSettings();
  await refreshUI();
})();
