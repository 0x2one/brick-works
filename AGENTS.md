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
- **main**: `src/main/index.ts` — frameless window (`frame: false`), IPC handlers (`window:*`, `fetch:image`)
- **preload**: `src/preload/index.ts` — exposes `window.electron` + `window.api` (`windowControls`, `fetchImage`); types in `src/preload/index.d.ts`
- **renderer**: `src/renderer/src/main.tsx` — React entry, HashRouter, i18n, ThemeProvider wrapping antd ConfigProvider
- **renderer alias**: `@renderer` → `src/renderer/src/` (Vite + `tsconfig.web.json` paths)
- **routing**: HashRouter in `App.tsx` — `AppLayout` (Sider + `TitleBar`) with routes `/dev-tools`, `/dev-tools/:toolId`, `/memo-sticky`, `/about`; `/` redirects to `/dev-tools`
- **dev tools**: `/dev-tools` grid + `/dev-tools/:toolId` detail are driven by the registry in `data/devTools.ts`. To add a tool: add an entry to the `devTools` array, create the page under `pages/tools/`, register a `<Route path="/dev-tools/:id">` render in `DevToolDetail.tsx`, add i18n keys in `locales/{zh,en}.json`
- **settings**: not a route — `Settings.tsx` is rendered inside a Modal opened from `TitleBar.tsx`; language (`localStorage.lang`) and theme (`localStorage.theme`) toggles live there
- **IPC pattern**: adding a channel touches 3 places — `ipcMain.handle` in `src/main/index.ts` → preload bridge in `src/preload/index.ts` → types in `src/preload/index.d.ts`
- **persistence**: localStorage keys `lang`, `theme`, `dev-tools-stats`, `brickworks:stickyTags`, `brickworks:stickyNotes` (no electron-store)
- TypeScript project references: `tsconfig.json` references `tsconfig.node.json` (main+preload) and `tsconfig.web.json` (renderer)

## Conventions

- **Prettier**: singleQuote, noSemi, printWidth 100, no trailingComma
- **ESLint**: `@electron-toolkit/eslint-config-ts` + React + Prettier
- **No tests** — no test deps in `package.json`
- **Theming**: hybrid antd + CSS vars — `ThemeProvider` sets `data-theme` on `<html>` and antd `ConfigProvider` algorithm; custom colors are CSS vars (`--accent`, `--border-subtle`, `--text-secondary`, `--sticky-text`) defined for `:root` and `[data-theme='dark']` in `assets/main.css` — do not hardcode hex in components
- **i18n**: i18next, fallback `en`, antd locale synced via `languageChanged` event in `main.tsx`
- **pnpm** with `shamefully-hoist=true` in `.npmrc`; `pnpm-workspace.yaml` `allowBuilds` gates electron/esbuild
- Electron downloads mirrored via `npmmirror.com` (`.npmrc` + `electron-builder.yml`)
- antd MCP configured in `.opencode/opencode.json`; project skills in `.agents/skills/` and `.claude/skills/` (antd, frontend-design)
