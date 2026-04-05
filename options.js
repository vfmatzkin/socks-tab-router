const proxyHostInput = document.getElementById("proxy-host");
const proxyPortInput = document.getElementById("proxy-port");
const apiUrlInput = document.getElementById("api-url");
const btnSave = document.getElementById("btn-save");
const saveStatus = document.getElementById("save-status");

const DEFAULTS = {
  proxyHost: "localhost",
  proxyPort: 1080,
  apiUrl: "",
};

// Load current settings
chrome.storage.sync.get(DEFAULTS, (data) => {
  proxyHostInput.value = data.proxyHost || DEFAULTS.proxyHost;
  proxyPortInput.value = data.proxyPort || DEFAULTS.proxyPort;
  apiUrlInput.value = data.apiUrl || "";
});

btnSave.addEventListener("click", () => {
  const proxyHost = proxyHostInput.value.trim() || DEFAULTS.proxyHost;
  const proxyPort = parseInt(proxyPortInput.value, 10) || DEFAULTS.proxyPort;
  const apiUrl = apiUrlInput.value.trim().replace(/\/+$/, ""); // strip trailing slashes

  chrome.storage.sync.set({ proxyHost, proxyPort, apiUrl }, () => {
    saveStatus.classList.remove("hidden");
    setTimeout(() => saveStatus.classList.add("hidden"), 2000);
  });
});
