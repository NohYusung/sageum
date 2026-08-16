import { rebuildAllSemanticGraph } from '../src/lib/server/semantic-graph-service';
import { getSupabaseAdminClient } from '../src/lib/server/supabase';

async function main() {
  const result = await rebuildAllSemanticGraph(getSupabaseAdminClient());
  console.log(
    `공통 의미 그래프 재색인 완료: 사용자 ${result.ownerCount}명 · 노드 ${result.nodeCount}개 · 1차 링크 ${result.linkCount}개`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
