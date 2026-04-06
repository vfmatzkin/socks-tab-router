# SOCKS Tab Router

Chrome extension that routes browser traffic through a SOCKS5 proxy. Route all traffic or pick individual tabs via right-click context menu.

## Features

- **All traffic mode** — route everything through the proxy
- **Per-tab mode** — right-click a page and select "Route this tab through proxy" to add its domain. Only those domains go through the proxy, everything else stays direct
- **Optional control API** — connect/disconnect a VPN or proxy service from the extension popup (requires a compatible HTTP API)
- **Status badge** — green "ON" for all-traffic, blue with domain count for per-tab mode

## Install

1. Clone or download this repo
2. Open `chrome://extensions` in any Chromium browser
3. Enable "Developer mode"
4. Click "Load unpacked" and select this directory

## Configuration

Click the gear icon in the popup or right-click the extension icon and select "Options".

| Setting | Default | Description |
|---------|---------|-------------|
| SOCKS Proxy Host | `localhost` | Proxy server address |
| SOCKS Proxy Port | `1080` | Proxy server port |
| Control API URL | (empty) | Optional HTTP API for connect/disconnect |

### Proxy-only mode (no API)

Leave the Control API URL empty. The popup shows proxy enable/disable and routing mode controls. You manage the SOCKS proxy yourself.

### With control API

Set the API URL (e.g. `http://localhost:1081`). The popup adds Connect/Disconnect buttons. The API must implement:

```
GET  /status     → {"connected": true|false}
POST /connect    → {"connected": true} or {"auth_url": "https://..."}
POST /disconnect → {"disconnected": true}
```

If `/connect` returns an `auth_url`, the extension opens it in a new tab and polls `/status` until connected.

## Usage

### Route all traffic

1. Click the extension icon
2. Click "Enable Proxy"
3. Select "All traffic" mode

### Route one tab

Right-click on any page → "Route this tab through proxy". The extension captures the domain and switches to per-tab mode. Only traffic to that domain goes through the proxy.

To stop routing a tab: right-click → "Stop routing this tab".

### With VPN integration

Set the Control API URL in settings. Click "Connect" in the popup. Authenticate if needed. The proxy enables automatically after connection.

## How it works

Uses Chrome's `chrome.proxy` API with dynamically generated PAC scripts. In per-tab mode, the PAC script checks the hostname against a list of routed domains and returns either `SOCKS5 host:port` or `DIRECT`.

Per-tab routing is domain-based (not truly per-tab). Two tabs on the same domain will both be routed. This is a Chrome API limitation.

## Running a SOCKS5 proxy

Any SOCKS5 proxy works. Some options:

```bash
# SSH tunnel
ssh -D 1080 -N user@server

# microsocks (lightweight, ~50KB)
microsocks -p 1080
```

You could also run a SOCKS5 proxy inside a Docker container that handles networking (VPN, Tor, custom routing) and expose port 1080 to the host. That way only the browser traffic you choose goes through the container's network, while the rest of your system stays clean. Add a small HTTP API to the container for connect/disconnect and set the Control API URL in the extension settings.

## License

MIT
