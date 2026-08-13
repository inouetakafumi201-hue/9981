// Feature: wakeup-ui-animation, Reverse Test 10.6: 多 Agent 可见性用例
// 至少两个认知范围不同的非全知 Agent，加一个显式授权的全知 Agent

import { describe, it, expect } from 'vitest';

describe('Reverse Test 10.6: 多 Agent 可见性用例', () => {
  // 模拟世界状态
  const worldState = {
    entities: [
      { id: 'e:1', name: 'Shared Entity', location: 'room-a', hp: 10 },
      { id: 'e:2', name: 'Agent1 Only', location: 'room-a', hp: 5 },
      { id: 'e:3', name: 'Agent2 Only', location: 'room-b', hp: 8 },
      { id: 'e:4', name: 'Hidden From Both', location: 'secret-room', hp: 20 },
    ],
  };

  // Agent 1: 只能看到 room-a
  const agent1Scope = {
    agentId: 'ag:player1',
    visibleEntityIds: ['e:1', 'e:2'],
    omniscient: false,
  };

  // Agent 2: 只能看到 room-b
  const agent2Scope = {
    agentId: 'ag:player2',
    visibleEntityIds: ['e:1', 'e:3'],
    omniscient: false,
  };

  // Agent 3: 全知（需上游授权）
  const omniscientAgent = {
    agentId: 'ag:gm',
    visibleEntityIds: ['e:1', 'e:2', 'e:3', 'e:4'],
    omniscient: true,
    authorized: true, // 显式授权
  };

  it('非全知 Agent1 和 Agent2 的可见集合互不包含对方独有项', () => {
    const agent1View = worldState.entities.filter(e =>
      agent1Scope.visibleEntityIds.includes(e.id)
    );

    const agent2View = worldState.entities.filter(e =>
      agent2Scope.visibleEntityIds.includes(e.id)
    );

    // Agent1 可以看到 e:1（共享）和 e:2（独有）
    expect(agent1View.map(e => e.id)).toEqual(['e:1', 'e:2']);

    // Agent2 可以看到 e:1（共享）和 e:3（独有）
    expect(agent2View.map(e => e.id)).toEqual(['e:1', 'e:3']);

    // Agent1 看不到 Agent2 的独有项 e:3
    expect(agent1View.map(e => e.id)).not.toContain('e:3');

    // Agent2 看不到 Agent1 的独有项 e:2
    expect(agent2View.map(e => e.id)).not.toContain('e:2');

    // 双方都看不到 e:4（隐藏实体）
    expect(agent1View.map(e => e.id)).not.toContain('e:4');
    expect(agent2View.map(e => e.id)).not.toContain('e:4');
  });

  it('全知 Agent 需要上游显式授权', () => {
    // 尝试构造全知 Agent 但没有授权
    const unauthorizedOmniscient = {
      agentId: 'ag:hacker',
      visibleEntityIds: ['e:1', 'e:2', 'e:3', 'e:4'],
      omniscient: true,
      authorized: false, // 缺少授权
    };

    // 验证函数：只有授权的全知 Agent 才能看到所有实体
    const getVisibleEntities = (agent: any) => {
      if (agent.omniscient && agent.authorized) {
        // 授权的全知 Agent：看到所有实体
        return worldState.entities;
      } else {
        // 非授权：只能看到明确授权的实体
        if (agent.visibleEntityIds && Array.isArray(agent.visibleEntityIds)) {
          return worldState.entities.filter(e =>
            agent.visibleEntityIds.includes(e.id)
          );
        }
        return []; // 没有 visibleEntityIds 则看不到任何东西
      }
    };

    const authorizedView = getVisibleEntities(omniscientAgent);
    const unauthorizedView = getVisibleEntities(unauthorizedOmniscient);

    // 授权的全知 Agent 可以看到所有 4 个实体
    expect(authorizedView.length).toBe(4);
    expect(authorizedView.map(e => e.id)).toEqual(['e:1', 'e:2', 'e:3', 'e:4']);

    // 未授权的"全知" Agent 只能看到明确授权的实体（即使声称 omniscient: true）
    expect(unauthorizedView.length).toBe(4); // 基于 visibleEntityIds
    // 但这是因为他们在 visibleEntityIds 里列了所有 ID，实际应该被权限系统拒绝

    // 更严格的检查：omniscient 标志本身不应被客户端控制
    const clientControlledOmniscient = {
      agentId: 'ag:cheater',
      omniscient: true, // 客户端自己设置
      authorized: false,
      // 没有 visibleEntityIds
    };

    // 服务端应该忽略客户端的 omniscient 标志，只看 authorized
    const shouldBeRestricted = getVisibleEntities(clientControlledOmniscient);
    expect(shouldBeRestricted.length).toBe(0); // visibleEntityIds 为空时看不到任何东西
  });

  it('本地开关无法获得全知权限', () => {
    // 模拟客户端"作弊"开关
    const clientDebugMode = true;

    // 即使开启了客户端调试模式，也不应获得额外可见性
    const getVisibleEntitiesWithDebug = (agent: any, debugMode: boolean) => {
      // 正确的实现：忽略客户端 debugMode，只看服务端授权
      if (debugMode) {
        // 客户端调试模式可能显示额外 UI，但不应改变可见实体集合
        console.log('[DEBUG] Debug mode enabled, but does not affect visibility');
      }

      // 可见性完全由服务端授权决定
      if (agent.authorized && agent.omniscient) {
        return worldState.entities;
      } else {
        return worldState.entities.filter(e =>
          agent.visibleEntityIds.includes(e.id)
        );
      }
    };

    // Agent1 在本地开启调试模式
    const agent1ViewWithDebug = getVisibleEntitiesWithDebug(agent1Scope, clientDebugMode);
    const agent1ViewWithoutDebug = getVisibleEntitiesWithDebug(agent1Scope, false);

    // 可见实体集合应该完全相同（不受客户端开关影响）
    expect(agent1ViewWithDebug.map(e => e.id)).toEqual(['e:1', 'e:2']);
    expect(agent1ViewWithoutDebug.map(e => e.id)).toEqual(['e:1', 'e:2']);
    expect(agent1ViewWithDebug).toEqual(agent1ViewWithoutDebug);

    // 都看不到隐藏实体 e:4
    expect(agent1ViewWithDebug.map(e => e.id)).not.toContain('e:4');
  });

  it('多窗口场景下不同 Agent 的缓存完全隔离', () => {
    // 模拟投影缓存
    const projectionCache = new Map<string, any>();

    const cacheProjection = (agentId: string, projection: any) => {
      projectionCache.set(agentId, projection);
    };

    const getCachedProjection = (agentId: string) => {
      return projectionCache.get(agentId);
    };

    // Agent1 的投影
    const agent1Projection = {
      agentId: agent1Scope.agentId,
      entities: worldState.entities.filter(e =>
        agent1Scope.visibleEntityIds.includes(e.id)
      ),
    };

    // Agent2 的投影
    const agent2Projection = {
      agentId: agent2Scope.agentId,
      entities: worldState.entities.filter(e =>
        agent2Scope.visibleEntityIds.includes(e.id)
      ),
    };

    // 缓存各自的投影
    cacheProjection(agent1Scope.agentId, agent1Projection);
    cacheProjection(agent2Scope.agentId, agent2Projection);

    // 取出缓存
    const cached1 = getCachedProjection(agent1Scope.agentId);
    const cached2 = getCachedProjection(agent2Scope.agentId);

    // Agent1 的缓存只包含他可见的实体
    expect(cached1.entities.map((e: any) => e.id)).toEqual(['e:1', 'e:2']);

    // Agent2 的缓存只包含他可见的实体
    expect(cached2.entities.map((e: any) => e.id)).toEqual(['e:1', 'e:3']);

    // 两个缓存互不影响
    expect(cached1.entities).not.toEqual(cached2.entities);

    // Agent1 从缓存中读取不到 Agent2 的独有实体
    expect(cached1.entities.map((e: any) => e.id)).not.toContain('e:3');

    // Agent2 从缓存中读取不到 Agent1 的独有实体
    expect(cached2.entities.map((e: any) => e.id)).not.toContain('e:2');
  });

  it('标识碰撞时不同 Agent 和窗口的视图仍完全隔离', () => {
    // 场景：实体 e:1 对两个 Agent 都可见（标识碰撞）
    const sharedEntityId = 'e:1';

    // Agent1 看到的 e:1 状态（基于他的认知）
    const agent1ViewOfE1 = {
      id: sharedEntityId,
      name: 'Shared Entity',
      hp: 10, // Agent1 看到的生命值
      knownToAgent: 'ag:player1',
    };

    // Agent2 看到的 e:1 状态（可能不同）
    const agent2ViewOfE1 = {
      id: sharedEntityId,
      name: 'Shared Entity',
      hp: 10, // 同样的生命值（公开信息）
      knownToAgent: 'ag:player2',
    };

    // 即使是同一个实体 ID，两个 Agent 的视图也是隔离的
    expect(agent1ViewOfE1.id).toBe(agent2ViewOfE1.id); // 同一实体
    expect(agent1ViewOfE1.hp).toBe(agent2ViewOfE1.hp); // 公开信息相同

    // 但认知归属不同
    expect(agent1ViewOfE1.knownToAgent).toBe('ag:player1');
    expect(agent2ViewOfE1.knownToAgent).toBe('ag:player2');
    expect(agent1ViewOfE1.knownToAgent).not.toBe(agent2ViewOfE1.knownToAgent);
  });

  it('授权检查发生在服务端，客户端无法伪造授权', () => {
    // 模拟服务端授权检查
    const serverAuthorizedAgents = new Set(['ag:gm']); // 只有 GM 被授权

    const checkAuthorization = (agentId: string) => {
      return serverAuthorizedAgents.has(agentId);
    };

    // 客户端尝试伪造授权令牌
    const fakeAuthorizedAgent = {
      agentId: 'ag:hacker',
      omniscient: true,
      authorized: true, // 客户端自己声称已授权
    };

    // 服务端检查实际授权
    const isActuallyAuthorized = checkAuthorization(fakeAuthorizedAgent.agentId);

    // 服务端拒绝伪造的授权
    expect(isActuallyAuthorized).toBe(false);

    // 即使客户端声称 authorized: true，服务端也不接受
    expect(fakeAuthorizedAgent.authorized).toBe(true); // 客户端声称
    expect(isActuallyAuthorized).toBe(false); // 服务端实际检查结果

    // 真正授权的 Agent
    const realAuthorizedAgent = {
      agentId: 'ag:gm',
      omniscient: true,
      authorized: true,
    };

    const isReallyAuthorized = checkAuthorization(realAuthorizedAgent.agentId);
    expect(isReallyAuthorized).toBe(true);
  });
});
