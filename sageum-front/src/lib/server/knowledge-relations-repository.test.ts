import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOneHopRuleGraph } from '@/lib/relations/graph';

test('문서 앵커에서 1단계로 도달한 규칙과 그 사이의 실제 연결을 모두 보여준다', () => {
  const links = [
    { id: 'address-hotel', left_rule_id: 'address', right_rule_id: 'hotel' },
    { id: 'address-district', left_rule_id: 'address', right_rule_id: 'district' },
    { id: 'district-hotel', left_rule_id: 'district', right_rule_id: 'hotel' },
    { id: 'unrelated-pair', left_rule_id: 'unrelated-a', right_rule_id: 'unrelated-b' },
  ];

  const graph = selectOneHopRuleGraph(links, new Set(['address']));

  assert.deepEqual([...graph.includedRuleIds].sort(), ['address', 'district', 'hotel']);
  assert.deepEqual(graph.visibleLinks.map((link) => link.id).sort(), [
    'address-district',
    'address-hotel',
    'district-hotel',
  ]);
});
