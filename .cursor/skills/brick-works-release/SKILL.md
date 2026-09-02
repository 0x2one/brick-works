---
name: brick-works-release
description: Ships a brick-works GitHub Release (CHANGELOG, version bump, tag, Actions draft build, then manual publish with release notes). Use when the user asks to 发版, 发布, create a version like v1.0.6, 打 tag, or update GitHub Release notes.
---

# brick-works 发版

CI 只上传**草稿**（`electron-builder --publish always`，GitHub `releaseType` 默认 draft）。`electron-updater` 只读已发布的 Release。正式发布必须在四平台全绿后执行 `gh release edit --draft=false`。

默认下一版本：当前 [`package.json`](package.json) `version` 的 patch +1（如 `1.0.6` → `1.0.7`），除非用户指定。

## 流程

复制并勾选：

```
- [ ] CHANGELOG 顶部新增 ## BrickWorks vX.Y.Z
- [ ] package.json version 与标签一致（如 1.0.6 / v1.0.6）
- [ ] 提交并 push origin main
- [ ] annotated tag 推到 origin（触发 Build & Release）
- [ ] Actions：Windows + macOS Intel + macOS Apple Silicon + Linux 全绿
- [ ] 核对产物文件名（见下方清单）
- [ ] gh release edit --draft=false，notes 来自 CHANGELOG 该版本
```

**1. CHANGELOG** — [`CHANGELOG.md`](CHANGELOG.md)

- 本仓库**没有** `## Unreleased`。在 `# Changelog` 下插入新小节 `## BrickWorks vX.Y.Z`，与上一版本之间保留 `---`。
- 内容来自上次 tag 以来的用户可见提交；不要写 skills / AGENTS.md / 内部文档类改动。
- 结构对齐已有版本：可选一句话摘要，然后 `### ✨ Features` / `### 🐛 Fixes`（英文条目）。
- GitHub Release body **不要**带 `## BrickWorks vX.Y.Z` 标题（Release 名已有）。可附 `**Full Changelog**: https://github.com/0x2one/brick-works/compare/vA.B.C...vX.Y.Z`。

**2. 版本号** — 只改根目录 [`package.json`](package.json) 的 `version`。

**3. 提交** — 一条 commit，消息对齐仓库：`chore: release vX.Y.Z`。先 `git status` / `diff` / `log`。

**4. 推送** — 用户说「发版 / 发布 vX.Y.Z」即授权 push `main` + 新 tag：

```bash
git push origin main
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

不要重写已有 tag，除非用户明确说清空旧 Release 并重打同一版本。

**5. 等 CI** — `gh run watch` 对应 workflow `Build & Release`（[`.github/workflows/build.yml`](.github/workflows/build.yml)）。四个 job 都成功再发布。

**6. 发布草稿** — 用 notes 文件（PowerShell 下 `--notes` 中文易乱码），并把标题设成 `BrickWorks vX.Y.Z`：

```bash
gh release edit vX.Y.Z --draft=false --title "BrickWorks vX.Y.Z" --notes-file <notes.md> -R 0x2one/brick-works
```

发完删掉临时 notes 文件。核对 `isDraft=false` 且产物齐全。

## 期望产物

| 文件 | 说明 |
|------|------|
| `brick-works-<ver>-win-x64.exe` | Windows NSIS |
| `brick-works-<ver>-mac-x64.dmg` / `.zip` | Intel，`macos-15-intel` 原生 |
| `brick-works-<ver>-mac-arm64.dmg` / `.zip` | Apple Silicon，`macos-15` 原生 |
| `brick-works-<ver>-linux-x86_64.AppImage` | Linux |
| `brick-works-<ver>-linux-amd64.deb` | Linux |
| `latest.yml` | Windows 自动更新 |
| `latest-mac.yml` | macOS 自动更新 |
| `latest-linux.yml` | Linux 自动更新 |

缺 Intel dmg、缺 Apple Silicon dmg、或两个 dmg 同名，视为失败，不要发布。

## 禁止

- 不要把 [`electron-builder.yml`](electron-builder.yml) 的 `publish.releaseType` 改成 `release`（并发上传会拆成多条同 tag Release）。
- 不要在 workflow 里自动 `gh release edit --draft=false`。
- 不要在单个 macOS job 里跑 `--mac --x64 --arm64`（交叉编译且 dmg 无 arch 会互相覆盖）。
- 不要改 [`pnpm-workspace.yaml`](pnpm-workspace.yaml) 里 `app-builder-lib>@electron/get` 的 `3.1.0` 覆盖（去掉会导致 electron-builder 26 打包崩溃）。

## 配置锚点

- Workflow：[`.github/workflows/build.yml`](.github/workflows/build.yml) — tag `v*` 触发；matrix 四平台 `electron-builder --publish always`，不自动把草稿改成正式版。
- 产物名：`win` / `mac` / `dmg` / `linux` 的 `artifactName` 为 `${name}-${version}-<platform>-${arch}.${ext}`。
- Linux CI 目标是 `AppImage deb`（不含 snap）。
- 仓库：`0x2one/brick-works`，默认分支 `main`。
