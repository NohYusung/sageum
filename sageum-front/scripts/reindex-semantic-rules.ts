import { rebuildAllSemanticRuleBindings } from '../src/lib/server/knowledge-rule-service';
import { getSupabaseAdminClient } from '../src/lib/server/supabase';

async function main() {
  const result = await rebuildAllSemanticRuleBindings(getSupabaseAdminClient());
  console.log(
    `의미 관계 재색인 완료: 사용자 ${result.ownerCount}명 · 규칙 ${result.ruleCount}개 · 문서 앵커 ${result.bindingCount}개 · 규칙 연결 ${result.linkCount}개`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
