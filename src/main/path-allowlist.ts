/** Dialog-selected and already-persisted local paths that main may read. */
const allowedLocalPaths = new Set<string>()

export function allowLocalPath(filePath: string): string {
  allowedLocalPaths.add(filePath)
  return filePath
}

export function assertAllowedLocalPath(filePath: string): void {
  if (!filePath || allowedLocalPaths.has(filePath)) return
  throw new Error('PATH_NOT_ALLOWED')
}

export function seedAllowedPaths(paths: Iterable<string | null | undefined>): void {
  for (const p of paths) {
    if (p) allowedLocalPaths.add(p)
  }
}
