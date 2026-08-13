/**
 * 引擎层加密哈希稳定端口契约（L0 不可变）
 *
 * 职责：通用 SHA-256 哈希计算，用于源码定位、制品签名、完整性验证。
 * 消费方：基类层 L2、玩法层、UGC 集成、持久化层
 * 版本：1.0.0（2026-08-11）
 *
 * 演变规则：
 * - 可增加新的哈希算法端口
 * - 不能改变现有 SHA-256 的输出
 * - 不能删除现有公共导出
 */

/**
 * SHA-256 哈希器端口
 *
 * 职责：从任意输入产生 64 字符十六进制字符串（256 比特）。
 * 契约：
 * - ✅ 使用标准 SHA-256 算法
 * - ✅ 相同输入产生相同输出（确定性）
 * - ✅ 支持 UTF-8 字符串、原始字节、文件内容
 * - ✅ 输出为小写十六进制字符串
 * - ❌ 不支持增量哈希（streaming）
 * - ❌ 不用于安全相关（如密钥导出）
 *
 * 使用场景：
 * 1. 源码 sourceSliceHash：精确定位创作者源码跨度
 * 2. Artifact hash：制品完整性验证
 * 3. Generation fingerprint：版本链追踪
 */
export interface Sha256HasherPort {
  /**
   * 从 UTF-8 字符串计算哈希
   *
   * 等价于: hash(Buffer.from(text, 'utf8'))
   */
  hashUtf8(text: string): string;

  /**
   * 从原始字节计算哈希
   */
  hashBytes(data: Uint8Array): string;

  /**
   * 从文件路径计算哈希
   *
   * 抛出：文件不存在、不可读
   */
  hashFile(filePath: string): string;
}

/**
 * SHA-256 输出格式（不可变）
 *
 * 64 个十六进制字符，代表 256 比特。
 * 示例：`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`（空字符串）
 */
export type Sha256Hash = string & { readonly __brand: 'Sha256Hash' };

/**
 * 构造强类型哈希值
 */
export function asSha256Hash(hex: string): Sha256Hash {
  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    throw new Error(`Invalid SHA-256 hash: ${hex}`);
  }
  return (hex.toLowerCase() as unknown) as Sha256Hash;
}

/**
 * 指纹计算策略
 *
 * 用于快照、registry 状态等的轻量级哈希。
 * 注意：FNV-1a 用于快照，非安全用途；持久制品使用 SHA-256。
 */
export enum FingerprintAlgorithm {
  /** 非安全快速哈希（快照、registry 状态） */
  FNV_1A = 'fnv-1a',
  /** 安全哈希（制品签名、版本链） */
  SHA256 = 'sha256',
}

/**
 * 指纹端口
 *
 * 职责：根据算法选择产生指纹。
 * 契约：
 * - ✅ FNV-1a：64 比特，快速，用于缓存/比较
 * - ✅ SHA-256：256 比特，安全，用于制品
 * - ✅ 相同输入产生相同输出
 * - ❌ FNV-1a 不用于安全相关
 */
export interface FingerprintPort {
  compute(data: Uint8Array, algorithm: FingerprintAlgorithm): string;
}
