#!/usr/bin/env node
/**
 * Repairs a half-extracted Electron install.
 *
 * Why this exists: electron's own postinstall (`node install.js`) extracts the
 * binary with extract-zip -> yauzl -> fd-slicer. On newer Node majors (26.x is
 * confirmed) that read stream delivers all bytes but never emits `end`, so the
 * extract promise never settles, the process exits 0, and the package is left
 * with a partial `dist/` and no `path.txt`. electron-vite then fails at startup
 * with "Electron uninstall".
 *
 * This script uses the platform's own unzip tool instead, so it works even when
 * the Node-side extractor is broken. Run it manually (`pnpm repair:electron`)
 * or let it run during install; it is a no-op when the install is healthy.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(projectRoot, 'package.json'))
const electronDir = path.dirname(require.resolve('electron/package.json'))
const { version } = JSON.parse(readFileSync(path.join(electronDir, 'package.json'), 'utf-8'))
const zipName = `electron-v${version}-${process.platform}-${process.arch}.zip`

function log(msg) {
  console.log(`[repair-electron] ${msg}`)
}

/** Relative path inside dist/ for the current platform, mirroring install.js. */
function platformPath() {
  switch (process.platform) {
    case 'darwin':
    case 'mas':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'win32':
      return 'electron.exe'
    default:
      return 'electron'
  }
}

/** Returns the executable path when the install looks complete, else null. */
function installedExecutable() {
  try {
    const relative = readFileSync(path.join(electronDir, 'path.txt'), 'utf-8').trim()
    if (!relative) return null

    const distVersion = readFileSync(path.join(electronDir, 'dist', 'version'), 'utf-8')
      .trim()
      .replace(/^v/, '')
    if (distVersion !== version) return null

    const exe = path.join(electronDir, 'dist', ...relative.split('/'))
    return existsSync(exe) ? exe : null
  } catch {
    return null
  }
}

/** Cache roots used by @electron/get, newest layout first. */
function cacheRoots() {
  const roots = []
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA)
      roots.push(path.join(process.env.LOCALAPPDATA, 'electron', 'Cache'))
  } else if (process.platform === 'darwin') {
    roots.push(path.join(homedir(), 'Library', 'Caches', 'electron'))
  } else {
    roots.push(path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'electron'))
  }
  return roots.filter(existsSync)
}

function findCachedZip() {
  for (const root of cacheRoots()) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(root, entry.name, zipName)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** Download base URL: env first, then .npmrc (electron_mirror), then GitHub. */
function mirrorBase() {
  const fromEnv = process.env.ELECTRON_MIRROR || process.env.npm_config_electron_mirror
  if (fromEnv) return fromEnv

  const npmrc = path.join(projectRoot, '.npmrc')
  if (existsSync(npmrc)) {
    const line = readFileSync(npmrc, 'utf-8')
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith('electron_mirror='))
    if (line) return line.slice('electron_mirror='.length).trim()
  }
  return 'https://github.com/electron/electron/releases/download/'
}

async function download(dest) {
  const base = mirrorBase().replace(/\/?$/, '/')
  const url = `${base}v${version}/${zipName}`
  log(`downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} while fetching ${url}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  return dest
}

/** Extracts `zip` into `dest` using a system tool, trying each fallback. */
function extract(zip, dest) {
  const tools = {
    win32: [['tar', ['-xf', zip, '-C', dest]]],
    darwin: [
      ['ditto', ['-x', '-k', zip, dest]],
      ['tar', ['-xf', zip, '-C', dest]]
    ],
    linux: [
      ['unzip', ['-q', zip, '-d', dest]],
      ['tar', ['-xf', zip, '-C', dest]]
    ]
  }[process.platform] || [['unzip', ['-q', zip, '-d', dest]]]

  const errors = []
  for (const [cmd, args] of tools) {
    try {
      execFileSync(cmd, args, { stdio: 'pipe' })
      return
    } catch (err) {
      errors.push(`${cmd}: ${err.message.split('\n')[0]}`)
    }
  }
  throw new Error(`could not extract ${path.basename(zip)}\n  ${errors.join('\n  ')}`)
}

async function main() {
  const healthy = installedExecutable()
  if (healthy) {
    log(`OK - Electron ${version} already installed`)
    return
  }

  log(`Electron ${version} install is incomplete, repairing ${electronDir}`)

  let zip = findCachedZip()
  if (zip) {
    log(`using cached archive ${zip}`)
  } else {
    const target = path.join(tmpdir(), zipName)
    zip = await download(target)
    log(`downloaded to ${zip}`)
  }

  const distDir = path.join(electronDir, 'dist')
  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })
  extract(zip, distDir)

  writeFileSync(path.join(electronDir, 'path.txt'), platformPath())

  const repaired = installedExecutable()
  if (!repaired) {
    throw new Error('extraction finished but the executable is still missing')
  }
  log(`fixed - ${repaired}`)
}

main().catch((err) => {
  console.error(`[repair-electron] FAILED: ${err.message}`)
  console.error(
    '[repair-electron] If this keeps happening, install Node 22 LTS (see .nvmrc) - ' +
      "electron's bundled extract-zip does not work on Node 26."
  )
  process.exitCode = 1
})
