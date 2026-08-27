/**
 * Browser-safe stub for node:fs — never actually called in the V0 shell runtime.
 * The real module is only used at build/test time in the main repo.
 */
export function readFileSync(): never {
  throw new Error('node:fs.readFileSync is not available in browser runtime')
}
export function readdirSync(): never {
  throw new Error('node:fs.readdirSync is not available in browser runtime')
}
export function statSync(): never {
  throw new Error('node:fs.statSync is not available in browser runtime')
}
export function writeFileSync(): never {
  throw new Error('node:fs.writeFileSync is not available in browser runtime')
}
export function mkdirSync(): never {
  throw new Error('node:fs.mkdirSync is not available in browser runtime')
}
export function rmSync(): never {
  throw new Error('node:fs.rmSync is not available in browser runtime')
}
export default { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync }
