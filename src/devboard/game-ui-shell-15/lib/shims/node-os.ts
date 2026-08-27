/**
 * Browser-safe stub for node:os.
 */
export function platform(): string {
  return 'browser'
}
export function homedir(): string {
  return '/'
}
export function tmpdir(): string {
  return '/tmp'
}
export default { platform, homedir, tmpdir }
