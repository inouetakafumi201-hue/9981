/**
 * Browser-safe stub for node:crypto. The V0 shell does not use real crypto.
 */
export function randomUUID(): string {
  return '00000000-0000-0000-0000-000000000000'
}
export const createHash = () => ({
  update() {
    return this
  },
  digest() {
    return ''
  },
})
export default { randomUUID, createHash }
