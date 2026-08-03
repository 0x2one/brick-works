import { resolve } from 'path'

/** Dialog-selected and already-persisted local paths that main may read. */
const allowedLocalPaths = new Set<string>()

function normalizePathKey(filePath: string): string {
  const resolved = resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function allowLocalPath(filePath: string): string {
  allowedLocalPaths.add(normalizePathKey(filePath))
  return filePath
}

export function assertAllowedLocalPath(filePath: string): void {
  if (!filePath || allowedLocalPaths.has(normalizePathKey(filePath))) return
  throw new Error('PATH_NOT_ALLOWED')
}

export function seedAllowedPaths(paths: Iterable<string | null | undefined>): void {
  for (const p of paths) {
    if (p) allowedLocalPaths.add(normalizePathKey(p))
  }
}
