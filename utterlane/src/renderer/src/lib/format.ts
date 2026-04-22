export function formatDuration(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms))
  const seconds = Math.floor(totalMs / 1000)
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  const cs = Math.floor((totalMs % 1000) / 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}
