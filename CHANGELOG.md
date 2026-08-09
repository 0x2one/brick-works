# Changelog

## BrickWorks v1.0.3

### ✨ Features
- New Hex Editor tool for binary file editing
- New Color Converter and Regex Tester tools
- New TextDiff tool with word-level highlight comparison
- DevTools layout improvements — sticky header and refined search input

### 🐛 Fixes
- Adjusted layout dimensions for the settings shell and modal

---

## BrickWorks v1.0.2

Feature and polish release.

### ✨ Features
- SSH Client: built-in Monaco file editor with SFTP file reading, editor maximize & sidebar visibility controls
- SSH Client: system information panel, command snippets, and log tailing with fullscreen toggle and dynamic resizing
- SSH Client: process/services/ports panels with search, symlink support, new-node quick add
- PDF preview tool, annotation shape & dimension quick input improvements

### 🐛 Fixes
- Fixed editor maximization logic in the SSH client
- Refined SSH client button styles for consistent UI

---

## BrickWorks v1.0.1

Bugfix and polish release.

### 🐛 Fixes
- Fixed an uncaught `globalShortcut` error on app quit when a second instance loses the single-instance lock (crash dialog on startup)
- Reorganized the macOS title bar layout — About/Settings buttons now sit next to the traffic lights instead of the far right, matching macOS conventions

---

## BrickWorks v1.0.0

First official release! A productivity workbench integrating dev tools, SSH tunnels, K8s management, LAN transfer, and more in one desktop app.

### ✨ Features

**Dev Toolbox**
- Tool hub homepage with detail pages, search, favorites, and usage tracking
- Tab bar position configurable (top / bottom / hidden), right-click to close all tabs
- Breadcrumb navigation on every tool detail page
- 20+ tools: JSON beautifier (tree/text view, BigInt support), codec converter (Unicode / Base64 / URL), timestamp converter, random password (batch generation, custom charsets), image-to-Base64, QR code generate/decode, SVG to image, UUID generator (v4 / Snowflake / NanoID), PDF merge/split, PDF & image annotation

**LAN Transfer**
- QR-code scan to connect, file transfer between browser and desktop
- Auto/IP selection detection with real-time transfer status
- Access token protection and zh/en web UI

**SSH Tunnels**
- GUI config for local / remote / dynamic (SOCKS5) port forwarding with persistent node management
- ProxyJump support, drag-and-drop node reordering
- Per-tunnel start/stop with validation and port-conflict detection

**SSH Client**
- Built-in terminal + SFTP file manager, secrets secured via OS encryption (safeStorage)
- Async host key verification with localized confirm dialog
- Reconnect, terminal themes, clipboard copy

**K8s Management**
- Cluster management with kubeconfig validation (path & content)
- Namespaces, pods, workloads, services, ingresses views with search
- Log viewing (tail / follow / download), terminal exec with shell selection
- Port forwarding with persistence and runtime error handling

**Sticky Notes**
- Desktop sticky notes with tags and persistent storage

**Experience**
- Frameless window with custom title bar, custom scrollbars, view transitions
- Launch at login, system tray, global hotkey to show/hide window
- Auto-update (check/download/install) with configurable auto-download
- Single-instance lock, dark/light themes, 10 accent colors, zh/en i18n

**Cross-platform & CI**
- GitHub Actions pipeline building installers for Windows / macOS (Intel + Apple Silicon) / Linux
- Unified artifact naming and auto-update publishing to GitHub Releases

### 🐛 Fixes
- Fixed an occasional blank page when switching navigation quickly
- Removed an antd Tooltip zIndex warning in the settings dialog
- Improved SSH client and tunnel form usability
- Adjusted window sizing and settings dialog layout for better ergonomics

---

### Install

- **Windows**: download `BrickWorks-1.0.0-setup.exe`
- **macOS**: download `BrickWorks-1.0.0-mac-arm64.dmg` (Apple Silicon) or `BrickWorks-1.0.0-mac-x64.dmg` (Intel)
- **Linux**: download `BrickWorks-1.0.0-linux-x64.AppImage` or `.deb`
