/** Paths this journal owns. Nothing points at another plugin's data. */

import os from 'node:os'
import path from 'node:path'

export function defaultStateDir(env = process.env, platform = process.platform) {
  if (typeof env.DSH_CHANGE_JOURNAL_STATE_DIR === 'string' && env.DSH_CHANGE_JOURNAL_STATE_DIR.trim() !== '') {
    return path.resolve(env.DSH_CHANGE_JOURNAL_STATE_DIR.trim())
  }
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
    return path.join(base, 'dsh-change-journal')
  }
  if (typeof env.XDG_STATE_HOME === 'string' && env.XDG_STATE_HOME.trim() !== '') {
    return path.join(path.resolve(env.XDG_STATE_HOME.trim()), 'dsh-change-journal')
  }
  return path.join(os.homedir(), '.local', 'state', 'dsh-change-journal')
}

export function statePaths(stateDir) {
  return {
    dir: stateDir,
    journal: path.join(stateDir, 'journal'),
    exports: path.join(stateDir, 'exports'),
    lock: path.join(stateDir, 'journal', '.lock'),
    loaded: path.join(stateDir, 'plugin-loaded.json'),
  }
}
