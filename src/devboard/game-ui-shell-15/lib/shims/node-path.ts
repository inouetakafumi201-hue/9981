/**
 * Re-implement a minimal path API for the browser. Only methods that are
 * transitively imported by the main-repo code paths reachable from the V0 shell
 * need to exist here.
 */
export function resolve(..._segments: string[]): string {
  return _segments[_segments.length - 1] ?? ''
}
export function join(...segments: string[]): string {
  return segments.filter(Boolean).join('/')
}
export function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '.' : p.slice(0, i)
}
export function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}
export function extname(p: string): string {
  const i = p.lastIndexOf('.')
  return i < 0 ? '' : p.slice(i)
}
export default { resolve, join, dirname, basename, extname }
