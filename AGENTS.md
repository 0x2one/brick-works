# brick-works

Electron + React 19 + TypeScript + antd 6 + Tailwind CSS v4.

## Commands

| Command                          | Action                                                   |
| -------------------------------- | -------------------------------------------------------- |
| `pnpm dev`                       | Start dev server (electron-vite)                         |
| `pnpm build`                     | **Run typecheck first** → `electron-vite build`          |
| `pnpm lint`                      | ESLint with cache                                        |
| `pnpm format`                    | Prettier (writes)                                        |
| `pnpm typecheck:node`            | `tsc --noEmit -p tsconfig.node.json --composite false`   |
| `pnpm typecheck:web`             | `tsc --noEmit -p tsconfig.web.json --composite false`    |
| `pnpm typecheck`                 | Runs node → web (sequential)                             |
| `pnpm build:win`                 | `build` (incl. typecheck) → electron-builder --win       |
| `pnpm build:mac` / `build:linux` | **Skip typecheck** — run `pnpm typecheck` manually first |
| `pnpm build:unpack`              | `build` (incl. typecheck) → `electron-builder --dir`     |
| `pnpm start`                     | `electron-vite preview`                                  |

No test framework is configured.

## Architecture

- **three Vite targets**: `main`, `preload`, `renderer` — defined in `electron.vite.config.ts`
- **main**: `src/main/index.ts` — single-instance lock, Tray + close-to-tray behavior, global "show window" shortcut, frameless window (`frame: false` on win/linux; macOS uses `titleBarStyle: 'hiddenInset'` with native traffic lights) plus services: LAN transfer (`lan-server.ts`), SSH tunnels (`ssh-manager.ts`/`ssh-store.ts`/`ssh-connect.ts`), SSH client shell/SFTP (`ssh-client-manager.ts`, shares `ssh-store`), K8s (`k8s-manager.ts`/`k8s-store.ts`), sticky notes (`sticky-store.ts`), app settings (`app-settings.ts`), auto-updater (`updater.ts`), path allowlist (`path-allowlist.ts`)
- **preload**: `src/preload/index.ts` — exposes `window.api` with namespaces `fetchImage`, `fetchSvg`, `app`, `settings`, `updater`, `windowControls`, `shortcuts`, `clipboard`, `files`, `lan`, `ssh`, `sticky`, `k8s` (`files.getPathForFile` uses `webUtils.getPathForFile`). Ambient API types are split per namespace across `src/preload/*.d.ts` (`lan.d.ts`, `ssh.d.ts`, `k8s.d.ts`, `sticky.d.ts`, `updater.d.ts`) and composed into `Api`/`Window.api` in `index.d.ts`; `tsconfig.web.json` includes `src/preload/*.d.ts`
- **renderer**: `src/renderer/src/main.tsx` — React entry, HashRouter, i18n, ThemeProvider wrapping antd ConfigProvider
- **renderer alias**: `@renderer` → `src/renderer/src/` (Vite + `tsconfig.web.json` paths)
- **routing**: HashRouter in `App.tsx`. `SshClient`, `K8sManage`, and `DevToolsArea` are **not** routes — they stay mounted once visited and are toggled via an `active` prop (with page-fade transitions and `animationend` watchdogs). `<Routes>` only handles `/memo-sticky`, `/lan-transfer`, `/ssh-tunnel`, `/about`, `/` → `/dev-tools`, `*` → `/`. `AppLayout` (Sider + `TitleBar`) syncs LAN server language via `window.api.lan.setLang`. Alt+1..6 jump between the 6 sidebar sections (disable via `navShortcut` setting)
- **dev tools**: `/dev-tools` grid + tool pages driven by the registry in `src/renderer/src/data/devTools.tsx` (also holds `useDevToolStats`, persisted to localStorage `dev-tools-stats`). Each tool entry carries an antd `icon` (rendered in the grid card, tab, and detail breadcrumb). Open tools render as tabs (localStorage `dev-tools-tabs`, position `dev-tools-tab-position`); `fill: true` lets a tool's page stretch to full height. To add a tool: add an entry to the `devTools` array, create the page under `pages/tools/`, register it in the `toolComponents` map in `DevToolDetail.tsx`, add i18n keys in `locales/{zh,en}.json`
- **settings**: not a route — `Settings.tsx` renders inside a Modal opened from `TitleBar.tsx`; covers language, theme/accent, tray/startup, show-shortcut, nav shortcuts, auto-update. Cross-page setting changes are pushed via `CustomEvent` (`nav-shortcut-toggle`, `dev-tools-tab-position-change`)
- **IPC pattern**: adding a channel touches 3 places — `ipcMain.handle` in `src/main/index.ts` → preload bridge in `src/preload/index.ts` → ambient types in `src/preload/*.d.ts`. Long-running services push state back via `webContents.send` (`lan:status-change`, `ssh:status-change`, `ssh:log`, `ssh:log-data`, `ssh:log-exit`, `ssh:shell-data`, `ssh:shell-exit`, `k8s:status-change`, `k8s:log-chunk`, `k8s:exec-data`, `k8s:exec-exit`, `k8s:portforward-status`, `updater:status`, `window:maximize-change`, `app:shortcut`); K8s exec / SSH shell I/O goes over base64 (`k8s:writeExec` → `k8s:exec-data`, `ssh:writeShell` → `ssh:shell-data`), rendered in xterm. Terminal shortcuts (Ctrl/Cmd+F, +/-/0) never hit the default menu — `setupAppMenu` swaps in a minimal Edit-only menu and `before-input-event` in `createWindow` forwards those keys to the renderer as `app:shortcut`
- **persistence**: renderer uses localStorage (`lang`, `theme`, `accent`, `sidebar-collapsed`, `dev-tools-stats`, `dev-tools-tabs`, `dev-tools-tab-position`); main services persist JSON under `app.getPath('userData')` — `ssh-nodes.json`, `k8s-clusters.json`, `k8s-port-forwards.json`, `k8s-kubeconfigs/`, `sticky-notes.json`, `app-settings.json` — no electron-store. SSH secrets are encrypted with `safeStorage`. Sticky notes moved from localStorage → main store; legacy `brickworks:stickyTags`/`brickworks:stickyNotes` are only migrated once, then cleared
- **security (main)**: `fetch:image` / `fetch:svg` reject private/loopback targets (checks hostname + resolved IPs, follows redirects manually re-validating each hop) and cap sizes; `openExternalSafe` guards all `shell.openExternal`. Local file reads are gated by the path allowlist (`path-allowlist.ts`) — only dialog-selected or already-persisted paths may be read; any new IPC that opens a local file must call `allowLocalPath` (dialog result) or `assertAllowedLocalPath`
- **auto-updater**: `updater.ts` (electron-updater) only runs when `app.isPackaged`; in dev it points at `dev-app-update.yml` (`provider: github`) so the flow can be exercised. `autoDownload` comes from settings
- TypeScript project references: `tsconfig.json` references `tsconfig.node.json` (main+preload) and `tsconfig.web.json` (renderer)

## Conventions

- **Prettier**: singleQuote, noSemi, printWidth 100, no trailingComma
- **ESLint**: `@electron-toolkit/eslint-config-ts` + React + Prettier
- **No tests** — no test deps in `package.json`
- **Theming**: hybrid antd + CSS vars — `ThemeProvider` (`theme/ThemeProvider.tsx`) sets `data-theme` (mode can be `system`/`light`/`dark`) and `data-accent` on `<html>` and drives antd `ConfigProvider` `colorPrimary` from `theme/accent.ts`. Custom colors are CSS vars (`--accent`, `--border-subtle`, `--text-secondary`, `--sticky-text`, `--bg-warm`, `--content-bg`) defined for `:root`, `[data-theme='dark']`, and per-accent `[data-accent='…']` blocks in `assets/main.css` — do not hardcode hex in components; add new accent palettes to `theme/accent.ts` + matching `main.css` overrides
- **Scrollbar & layout**: scrollbars go at the far right of the window, flush to the edge, spanning top-to-bottom — the app scrolls in `.content-area` (`overflow-auto flex flex-col flex-1 min-h-0` in `App.tsx`), never mid-page. Global styling in `assets/main.css`: thin (8px), transparent track, rounded thumb using `--border-subtle` (hover: `--text-secondary`), Firefox via `scrollbar-width: thin`/`scrollbar-color`; scrollable areas use `scrollbar-gutter: stable` to avoid layout shift. Do not re-theme scrollbars per component; drive color from CSS vars so dark mode stays consistent. Page headers are always pinned: `sticky top-0 z-10 bg-[var(--content-bg)]` while body content scrolls beneath (pattern used in `tools/*` and `SshTunnel.tsx`). Pagination/footers are pinned at the bottom too — keep the pager in a `shrink-0` footer outside the scrollable body (see `K8sManage.tsx` `.k8s-page-body` + `k8s-page-footer`)
- **i18n**: i18next, fallback `en`, antd locale synced via `languageChanged` event in `main.tsx`
- **LAN web UI**: served by `lan-server.ts` from a single bundled HTML (`src/main/lan-web/index.html`, imported via `?raw`); any LAN UI change goes in that file. It has its own i18n stored under `lan-web-lang`
- **pnpm** with `shamefully-hoist=true` in `.npmrc`; `pnpm-workspace.yaml` `allowBuilds` gates electron/esbuild and the native SSH deps `ssh2`/`cpu-features`, and pins `app-builder-lib>@electron/get` to `3.1.0` (an override that prevents an electron-builder 26 packaging crash — don't remove it)
- **Native deps**: `ssh2`, `@kubernetes/client-node` run in main; `electron-builder.yml` sets `npmRebuild: false`
- Electron downloads mirrored via `npmmirror.com` (`.npmrc` + `electron-builder.yml`)
- **CI**: `.github/workflows/build.yml` runs `pnpm run build` then `electron-builder --win/--mac/--linux --publish always` on `v*` tags (or `workflow_dispatch`); releases come from tags
- antd MCP configured in `.opencode/opencode.json`; project skills in `.agents/skills/` and `.claude/skills/` (antd, frontend-design)
