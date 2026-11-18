/** Local time with an explicit offset, and day keys in a configured time zone. */

export const EVENT_SCHEMA = 'dsh.change-journal/event@1'
export const JOURNAL_VERSION = 1

export function isoLocal(ms) {
  const date = new Date(ms)
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const pad = value => String(Math.floor(Math.abs(value))).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
}

export function resolveTimeZone(configured) {
  if (typeof configured === 'string' && configured !== '') return configured
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** `YYYY-MM-DD` in the given IANA time zone. */
export function dayKey(ms, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString().slice(0, 10)
  }
}

/** `YYYY-MM` in the given IANA time zone; also the segment file name. */
export function monthKey(ms, timeZone) {
  return dayKey(ms, timeZone).slice(0, 7)
}
