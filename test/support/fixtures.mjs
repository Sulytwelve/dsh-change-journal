/** Shared fixtures for the change-journal tests. */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeConfig } from '../../lib/config.mjs'
import { createStore } from '../../lib/store.mjs'

export function tempDir(prefix = 'ms-journal-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function makeStore(overrides = {}) {
  const stateDir = tempDir()
  const config = normalizeConfig(overrides)
  const store = createStore({ stateDir, config })
  return { stateDir, config, store }
}

export function writeFile(dir, name, text) {
  const file = path.join(dir, name)
  fs.writeFileSync(file, text)
  return file
}

export function readEvents(store) {
  return store.readEvents()
}
