/**
 * `StableFingerprintGateway` 的默认实现。
 *
 * 选型说明（记录于 .kiro/specs/wakeup-ugc/实施基线与决策记录.md §1.2.8）：使用 `node:crypto` 的 SHA-256，
 * 与本仓库既有做法一致（`kernel/ai/kernel/state-read.ts`、`l2/model/source-record.ts`、`spec-compiler/*`
 * 均直接使用它）。自行实现密码学哈希只会引入一处未经检验的自研代码。端口仍可注入替身。
 */
import { createHash } from 'node:crypto';
import type { StableFingerprintGateway } from '../model/fingerprint';

export const SHA256_ALGORITHM_ID = 'sha256-hex-v1';

class Sha256FingerprintGateway implements StableFingerprintGateway {
  readonly algorithmId = SHA256_ALGORITHM_ID;

  fingerprintBytes(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  fingerprintText(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }
}

/**
 * 共享无状态实例。指纹计算是纯函数，没有可变状态，因此复用单例不会造成跨候选串扰。
 */
export const sha256FingerprintGateway: StableFingerprintGateway = new Sha256FingerprintGateway();
