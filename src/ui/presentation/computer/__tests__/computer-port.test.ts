import { describe, expect, it } from 'vitest';

import type { ComputerState, ComputerOperation } from '../computer-port';

// Note: These tests verify the type contracts and structural expectations.
// The actual implementation will be provided by the host system.

describe('computer-port', () => {
  describe('ComputerStatePort interface', () => {
    it('should define ComputerState structure', () => {
      // This test verifies the expected shape via type checking
      const expectedState: ComputerState = {
        cpuLevel: 3,
        memoryUsed: 512,
        memoryTotal: 1024,
        storageUsed: 2048,
        storageTotal: 4096,
        processes: [
          {
            id: 'proc:1',
            name: '扫描任务',
            status: 'running' as const,
            cpuUsage: 80,
            memoryUsage: 128,
          },
        ],
        logs: ['启动完成', '扫描中'],
        isActive: true,
      };

      expect(expectedState.cpuLevel).toBe(3);
      expect(expectedState.processes).toHaveLength(1);
      expect(expectedState.logs).toHaveLength(2);
    });
  });

  describe('ComputerOperation types', () => {
    it('should support process operations', () => {
      const computeOp: ComputerOperation = {
        type: 'compute',
        target: 'target:matrix',
        parameters: { depth: 5 },
      };

      const scanOp: ComputerOperation = {
        type: 'scan',
        target: 'target:scan-node-1',
      };

      const decryptOp: ComputerOperation = {
        type: 'decrypt',
        target: 'encrypted:data-A',
        parameters: { algorithm: 'AES-256' },
      };

      expect(computeOp.type).toBe('compute');
      expect(scanOp.type).toBe('scan');
      expect(decryptOp.type).toBe('decrypt');
    });
  });
});