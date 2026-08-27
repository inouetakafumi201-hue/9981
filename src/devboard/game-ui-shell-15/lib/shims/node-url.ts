/**
 * Browser-safe stub for the parts of node:url used by main-repo code reachable
 * from the V0 shell. Only `fileURLToPath` is provided; `URL` is a browser global.
 */
export function fileURLToPath(_url: string | URL): string {
  const s = typeof _url === 'string' ? _url : _url.href
  return s.replace(/^file:\/\//, '')
}
export function pathToFileURL(p: string): URL {
  return new URL(`file://${p}`)
}
export default { fileURLToPath, pathToFileURL }
