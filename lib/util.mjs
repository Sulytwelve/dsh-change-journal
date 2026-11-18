/** Hashing, clipping and command redaction for journal records. */

import crypto from 'node:crypto'
import fs from 'node:fs'

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/**
 * Hash one file without buffering it, bounded by `maxBytes`.
 * @param {string} file
 * @param {{maxBytes?: number, fs?: typeof fs}} options
 */
export async function hashFile(file, { maxBytes = 512 * 1024 * 1024, fs: fileSystem = fs } = {}) {
  const stat = fileSystem.statSync(file)
  if (!stat.isFile()) throw Object.assign(new Error(`${file} is not a regular file`), { code: 'ENOTFILE' })
  if (stat.size > maxBytes) throw Object.assign(new Error(`${file} exceeds the hash budget (${stat.size} > ${maxBytes})`), { code: 'ETOOBIG' })
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    let bytes = 0
    const stream = fileSystem.createReadStream(file)
    stream.on('data', chunk => { bytes += chunk.length; hash.update(chunk) })
    stream.on('error', reject)
    stream.on('end', () => resolve({ sha256: hash.digest('hex'), bytes }))
  })
}

/** A lowercase bare sha256, or null when the input is not one. */
export function normalizeSha256(value) {
  if (typeof value !== 'string') return null
  const bare = value.trim().replace(/^sha256:/i, '').toLowerCase()
  return /^[0-9a-f]{64}$/.test(bare) ? bare : null
}

export function clip(text, max) {
  const value = String(text ?? '')
  if (value.length <= max) return value
  return `${value.slice(0, max)}… (${value.length - max} chars cut)`
}

const SECRET_ASSIGNMENT = /(\b(?:token|secret|password|passwd|api[_-]?key|authorization)\b\s*[=:]\s*)(["']?)([^\s"']+)\2/gi

/**
 * Replace credential-looking values while keeping the command usable.
 * Returns `{command, redacted}`; the caller records the marker explicitly.
 */
export function redactCommand(command) {
  let redacted = false
  const text = String(command ?? '').replace(SECRET_ASSIGNMENT, (_match, prefix, quote) => {
    redacted = true
    return `${prefix}${quote}***${quote}`
  })
  return { command: text, redacted }
}
