/**
 * Minimal Buffer shim for browser compilation.
 *
 * Only `byteLength` and `from` are implemented; both are needed by the
 * strict-json-codec and source-record paths that the V0 shell transitively
 * imports.  Other methods throw at runtime.
 */
const encoder = new TextEncoder()

export class Buffer {
  static byteLength(s: string, _encoding?: string): number {
    return encoder.encode(s).length
  }
  static from(_data: unknown): { toString(): string } {
    return { toString: () => '' }
  }
  static alloc(): never {
    throw new Error('Buffer.alloc not available in browser runtime')
  }
  static isBuffer(): boolean {
    return false
  }
}
export default Buffer
