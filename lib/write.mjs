/** Atomic JSON writes for the heartbeat and exports. */

import fs from 'node:fs'
import path from 'node:path'

export function writeJsonAtomic(file, value, { fs: fileSystem = fs } = {}) {
  const directory = path.dirname(file)
  fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = `${file}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
  try {
    fileSystem.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    fileSystem.renameSync(temporary, file)
  } catch (error) {
    try { fileSystem.unlinkSync(temporary) } catch { /* nothing to clean */ }
    throw error
  }
}
