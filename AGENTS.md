# brick-works

Electron + React 19 + TypeScript + antd 6 + Tailwind CSS v4.

## Commands

| Command | Action |
|---|---|
| `pnpm dev` | Start dev server (electron-vite) |
| `pnpm build` | **Run typecheck first** → `electron-vite build` |
| `pnpm lint` | ESLint with cache |
| `pnpm format` | Prettier (writes) |
| `pnpm typecheck:node` | `tsc --noEmit -p tsconfig.node.json --composite false` |
| `pnpm typecheck:web` | `tsc --noEmit -p tsconfig.web.json --composite false` |
| `pnpm typecheck` | Runs node → web (sequential) |
| `pnpm build:win` | `build` (incl. typecheck) → electron-builder --win |
| `pnpm build:mac` / `build:linux` | **Skip typecheck** — run `pnpm typecheck` manually first |

No test framework is configured.

## Architecture

- **three Vite targets**: `main`, `preload`, `renderer` — defined in `electron.vite.config.ts`
- **main**: `src/main/index.ts` — frameless window (`frame: false`, `sandbox: false`) plus three persistent services: LAN transfer (`lan-server.ts`), SSH tunnels (`ssh-manager.ts`/`ssh-store.ts`), K8s (`k8s-manager.ts`/`k8s-store.ts`)
- **preload**: `src/preload/index.ts` — exposes `window.electron` + `window.api` with namespaces `windowControls`, `lan`, `ssh`, `k8s`, `fetchImage`; types are declared globally in `src/preload/index.d.ts`
- **renderer**: `src/renderer/src/main.tsx` — React entry, HashRouter, i18n, ThemeProvider wrapping antd ConfigProvider
- **renderer alias**: `@renderer` → `src/renderer/src/` (Vite + `tsconfig.web.json` paths)
- **routing**: HashRouter in `App.tsx` — `AppLayout` (Sider + `TitleBar`) with routes `/dev-tools`, `/dev-tools/:toolId`, `/memo-sticky`, `/lan-transfer`, `/ssh-tunnel`, `/k8s`, `/about`; `/` redirects to `/dev-tools`. `AppLayout` syncs the LAN server language via `window.api.lan.setLang` on i18n change
- **dev tools**: `/dev-tools` grid + `/dev-tools/:toolId` detail driven by the registry in `src/renderer/src/data/devTools.ts` (same file holds `useDevToolStats`, persisted to localStorage `dev-tools-stats`). To add a tool: add an entry to the `devTools` array, create the page under `pages/tools/`, register it in the `toolComponents` map in `DevToolDetail.tsx`, add i18n keys in `locales/{zh,en}.json`
- **settings**: not a route — `Settings.tsx` is rendered inside a Modal opened from `TitleBar.tsx`; language (`localStorage.lang`) and theme (`localStorage.theme`) toggles live there
- **IPC pattern**: adding a channel touches 3 places — `ipcMain.handle` in `src/main/index.ts` → preload bridge in `src/preload/index.ts` → types in `src/preload/index.d.ts`. Long-running services push state back via `webContents.send` (`lan:status-change`, `ssh:status-change`, `ssh:log`, `k8s:status-change`, `k8s:log-chunk`, `k8s:exec-data`, `k8s:exec-exit`, `k8s:portforward-status`); K8s exec I/O goes over base64 (`k8s:writeExec` → `k8s:exec-data`), rendered in xterm
- **persistence**: renderer uses localStorage (`lang`, `theme`, `dev-tools-stats`, `brickworks:stickyTags`, `brickworks:stickyNotes`, K8s page prefs); main services persist JSON under `app.getPath('userData')` — `ssh-nodes.json`, `k8s-clusters.json`, `k8s-port-forwards.json`, `k8s-kubeconfigs/` — no electron-store. SSH secrets are encrypted with `safeStorage`
- TypeScript project references: `tsconfig.json` references `tsconfig.node.json` (main+preload) and `tsconfig.web.json` (renderer)

## Conventions

- **Prettier**: singleQuote, noSemi, printWidth 100, no trailingComma
- **ESLint**: `@electron-toolkit/eslint-config-ts` + React + Prettier
- **No tests** — no test deps in `package.json`
- **Theming**: hybrid antd + CSS vars — `ThemeProvider` sets `data-theme` on `<html>` and antd `ConfigProvider` algorithm; custom colors are CSS vars (`--accent`, `--border-subtle`, `--text-secondary`, `--sticky-text`) defined for `:root` and `[data-theme='dark']` in `assets/main.css` — do not hardcode hex in components
- **Scrollbar & layout**: scrollbars go at the far right of the window, flush to the edge, spanning top-to-bottom — the app scrolls in `.content-area` (`overflow-auto flex flex-col flex-1 min-h-0` in `App.tsx`), never mid-page. Global styling in `assets/main.css`: thin (8px), transparent track, rounded thumb using `--border-subtle` (hover: `--text-secondary`), Firefox via `scrollbar-width: thin`/`scrollbar-color`; scrollable areas use `scrollbar-gutter: stable` to avoid layout shift. Do not re-theme scrollbars per component; drive color from CSS vars so dark mode stays consistent. Page headers are always pinned: `sticky top-0 z-10 bg-[var(--content-bg)]` while body content scrolls beneath (pattern used in `tools/*` and `SshTunnel.tsx`). Pagination/footers are pinned at the bottom too — keep the pager in a `shrink-0` footer outside the scrollable body (see `K8sManage.tsx` `.k8s-page-body` + `k8s-page-footer`)
- **i18n**: i18next, fallback `en`, antd locale synced via `languageChanged` event in `main.tsx`
- **LAN web UI**: served by `lan-server.ts` from a single bundled HTML (`src/main/lan-web/index.html`, imported via `?raw`); any LAN UI change goes in that file. It has its own i18n stored under `lan-web-lang`
- **pnpm** with `shamefully-hoist=true` in `.npmrc`; `pnpm-workspace.yaml` `allowBuilds` gates electron/esbuild and the native SSH deps `ssh2`/`cpu-features`
- **Native deps**: `ssh2`, `@kubernetes/client-node` run in main; `electron-builder.yml` sets `npmRebuild: false`
- Electron downloads mirrored via `npmmirror.com` (`.npmrc` + `electron-builder.yml`)
- antd MCP configured in `.opencode/opencode.json`; project skills in `.agents/skills/` and `.claude/skills/` (antd, frontend-design)
