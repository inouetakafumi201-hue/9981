/** 测试辅助：仓库根路径（从本目录向上 5 层到仓库根）。 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..');
