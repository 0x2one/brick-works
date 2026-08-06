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
- Tool hub with a searchable grid and usage tracking
- 10+ built-in tools: random password, JSON beautify/tree, codec converter, timestamp converter, UUID generator, QR code, SVG→image, image→base64, PDF merge/split, PDF image annotate
- Multi-tab workflow — tab bar position (top / bottom / hidden) and accent color are configurable

### ⚡ LAN Transfer
- QR-code scan to connect, transfer files between browser and desktop
- Auto / IP-selection detection with real-time transfer status

### 🔌 SSH Tunnels
- GUI config for local / remote / dynamic port forwarding
- Persistent node management with **ProxyJump** support

### 💻 SSH Client
- Built-in xterm terminal + SFTP file manager
- Secrets secured via OS-level encryption (`safeStorage`)
- Automatic host key verification, zh/en bilingual

### ☸️ K8s Management
- Cluster management, log streaming, terminal exec, port forwarding

### 🗒️ Sticky Notes
- Desktop sticky notes with persistent storage and drag-and-drop

### 🎛️ Experience
- Launch at login, system tray, global hotkey to show/hide window
- Auto-update (check / download / install) with configurable auto-download
- Single-instance lock, 10 accent themes, dark/light mode, zh/en i18n
- Frameless window with custom scrollbars

## 🧰 Tech Stack

| Layer | Tech |
|---|---|
| Shell | Electron 39 · electron-vite 5 · electron-builder 26 |
| UI | React 19 · TypeScript 5.9 · Ant Design 6 · Tailwind CSS 4 |
| Terminal | @xterm/xterm |
| Native | ssh2 · @kubernetes/client-node · pdf-lib · pdfjs-dist |
| State | localStorage persistence · i18next |

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

| Command | Action |
|---|---|
| `pnpm dev` | Start dev server |
| `pnpm build` | Typecheck → `electron-vite build` |
| `pnpm typecheck` | Type-check node + web targets |
| `pnpm lint` | ESLint (cached) |
| `pnpm format` | Prettier (writes) |
| `pnpm start` | Preview production build |

## 📄 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

## 📝 License

Released under the [MIT](./LICENSE) License.

---

<div align="center">
  Built with ❤️ · BrickWorks 1.0.0
</div>
