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
| `pnpm build:win` / `build:mac` / `build:linux` | Build + electron-builder |

No test framework is configured.

## Architecture

- **three Vite targets**: `main`, `preload`, `renderer` — defined in `electron.vite.config.ts`
- **main**: `src/main/index.ts` — frameless window (`frame: false`), IPC handlers for window controls
- **preload**: `src/preload/index.ts` — exposes `window.electron` + `window.api` (`windowControls` for min/max/close)
- **renderer**: `src/renderer/src/main.tsx` — React entry, HashRouter, i18n, ThemeProvider wrapping antd ConfigProvider
- **renderer alias**: `@renderer` → `src/renderer/src/` (Vite config)
- **routing**: HashRouter in `App.tsx` — layout route → `DevTools` (index) and `About`
- **custom title bar**: `TitleBar.tsx` — uses `window.api.windowControls.*` IPC calls
- **i18n**: `i18next` + `react-i18next`, locale stored in `localStorage.lang`, antd locale synced via `languageChanged` event
- **theme**: `system`/`light`/`dark`, stored in `localStorage.theme`, applied via `data-theme` attribute on `<html>` + antd `ConfigProvider` algorithm
- TypeScript project references: `tsconfig.json` references `tsconfig.node.json` (main+preload) and `tsconfig.web.json` (renderer)

## Conventions

- **Prettier**: singleQuote, noSemi, printWidth 100, no trailingComma
- **ESLint**: `@electron-toolkit/eslint-config-ts` + React + Prettier
- **No tests** — no test deps in `package.json`
- **pnpm** with `shamefully-hoist=true` in `.npmrc`
- Electron downloads mirrored via `npmmirror.com` (`.npmrc` + `electron-builder.yml`)
- antd skill available in `.agents/skills/antd/` and `.claude/skills/antd/`
