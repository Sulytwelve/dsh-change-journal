/** Starting policy. Every numeric default is calibrate-required unless noted in README. */

export const DEFAULT_CONFIG = Object.freeze({
  schema: 1,
  enabled: true,
  passive: true,
  timezone: null,
  retentionDays: 90,
  quotaBytes: 64 * 1024 * 1024,
  hashMaxBytes: 512 * 1024 * 1024,
  maxVerifyOutputBytes: 8 * 1024,
  maxEventsPerQuery: 500,
})

function finite(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

/**
 * @param {unknown} raw
 */
export function normalizeConfig(raw = {}) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const timezone = typeof input.timezone === 'string' && input.timezone.trim() !== '' ? input.timezone.trim() : null
  if (timezone !== null) {
    try { new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(0)) }
    catch { /* invalid time zone falls back to the host zone */ }
  }
  const validTimezone = timezone !== null && (() => {
    try { new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(0)); return true }
    catch { return false }
  })()
  return {
    schema: 1,
    enabled: input.enabled !== false,
    passive: input.passive !== false,
    timezone: validTimezone ? timezone : null,
    retentionDays: Math.round(finite(input.retentionDays, DEFAULT_CONFIG.retentionDays, { min: 1, max: 3650 })),
    quotaBytes: finite(input.quotaBytes, DEFAULT_CONFIG.quotaBytes, { min: 1024 * 1024, max: 100 * 1024 * 1024 * 1024 }),
    hashMaxBytes: finite(input.hashMaxBytes, DEFAULT_CONFIG.hashMaxBytes, { min: 65_536, max: 4 * 1024 * 1024 * 1024 }),
    maxVerifyOutputBytes: finite(input.maxVerifyOutputBytes, DEFAULT_CONFIG.maxVerifyOutputBytes, { min: 256, max: 256 * 1024 }),
    maxEventsPerQuery: Math.round(finite(input.maxEventsPerQuery, DEFAULT_CONFIG.maxEventsPerQuery, { min: 10, max: 10_000 })),
  }
}
