<div align="center">

# 🧱 BrickWorks · 积木工坊

> 一块块拼起你的开发工作台 — a desktop productivity workbench for developers

![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-2a2520)
![Electron](https://img.shields.io/badge/Electron-39-47848F)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6)
![Ant Design](https://img.shields.io/badge/Ant%20Design-6-1677FF)
![License](https://img.shields.io/badge/License-MIT-2a2520)

</div>

---

## ✨ Overview

BrickWorks is an Electron + React desktop workbench that bundles everyday developer tools into one frameless, keyboard-friendly app. No more juggling separate utilities — everything lives in a single window, themed to your taste.

## 🚀 Features

### 🧰 Dev Toolbox

- Tool hub homepage with detail pages, search, favorites, and usage tracking
- 20+ built-in tools: JSON beautifier (tree/text view, BigInt support), codec converter (Unicode / Base64 / URL), timestamp converter, random password (batch generation, custom charsets), image-to-Base64, QR code generate/decode, SVG to image, UUID generator (v4 / Snowflake / NanoID), PDF merge/split, PDF & image annotation
- Multi-tab workflow — tab bar position (top / bottom / hidden) configurable, right-click to close all tabs
- Breadcrumb navigation on every tool detail page

### ⚡ LAN Transfer

- QR-code scan to connect, transfer files between browser and desktop
- Auto / IP-selection detection with real-time transfer status
- Access token protection and zh/en web UI

### 🔌 SSH Tunnels

- GUI config for local / remote / dynamic (SOCKS5) port forwarding
- Persistent node management with **ProxyJump** support and drag-and-drop reordering
- Per-tunnel start/stop with validation and port-conflict detection

### 💻 SSH Client

- Built-in xterm terminal + SFTP file manager
- Secrets secured via OS-level encryption (`safeStorage`)
- Async host key verification with localized confirm dialog, reconnect, terminal themes, clipboard copy

### ☸️ K8s Management

- Cluster management with kubeconfig validation (path & content)
- Namespaces, pods, workloads, services, ingresses views with search
- Log viewing (tail / follow / download), terminal exec with shell selection
- Port forwarding with persistence and runtime error handling

### 🗒️ Sticky Notes

- Desktop sticky notes with tags and persistent storage

### 🎛️ Experience

- Launch at login, system tray, global hotkey to show/hide window
- Auto-update (check / download / install) with configurable auto-download
- Single-instance lock, 10 accent themes, dark/light mode, zh/en i18n
- Frameless window with custom title bar, custom scrollbars, view transitions

### 🔁 Cross-platform & CI

- GitHub Actions pipeline building installers for Windows / macOS (Intel + Apple Silicon) / Linux
- Unified artifact naming and auto-update publishing to GitHub Releases

## 📦 Download

Grab the latest release from the [Releases](https://github.com/zero2one/brick-works/releases) page:

| Platform              | Artifact                                           |
| --------------------- | -------------------------------------------------- |
| Windows               | `BrickWorks-<version>-setup.exe`                   |
| macOS (Apple Silicon) | `BrickWorks-<version>-mac-arm64.dmg`               |
| macOS (Intel)         | `BrickWorks-<version>-mac-x64.dmg`                 |
| Linux                 | `BrickWorks-<version>-linux-x64.AppImage` / `.deb` |

## 🚦 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 22
- [pnpm](https://pnpm.io/) (with `shamefully-hoist=true` configured)

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

### Build

```bash
# Windows (runs typecheck first)
$ pnpm build:win

# macOS
$ pnpm typecheck && pnpm build:mac

# Linux
$ pnpm typecheck && pnpm build:linux
```

### Package Scripts

| Command          | Action                            |
| ---------------- | --------------------------------- |
| `pnpm dev`       | Start dev server                  |
| `pnpm build`     | Typecheck → `electron-vite build` |
| `pnpm typecheck` | Type-check node + web targets     |
| `pnpm lint`      | ESLint (cached)                   |
| `pnpm format`    | Prettier (writes)                 |
| `pnpm start`     | Preview production build          |

## 📄 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## 📝 License

Released under the [MIT](./LICENSE) License.

---

<div align="center">
  Built with ❤️ · BrickWorks 1.0.0
</div>
