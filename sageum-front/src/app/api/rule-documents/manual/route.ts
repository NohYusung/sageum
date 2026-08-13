import type { ManualRuleMutationResponse } from '@/lib/relations/types';
import { ManualRuleValidationError } from '@/lib/relations/manual-rule';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import {
  createManualRuleDocument,
  ManualRuleDocumentError,
} from '@/lib/server/manual-rule-document';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const body = await request.json().catch(() => null) as { content?: unknown } | null;
  try {
    const result = await createManualRuleDocument(context.ownerId, body?.content);
    return Response.json(result satisfies ManualRuleMutationResponse, { status: 202 });
  } catch (error) {
    if (error instanceof ManualRuleValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ManualRuleDocumentError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to create a manual rule document', error);
    return Response.json({ error: '직접 입력 규칙을 등록하지 못했습니다.' }, { status: 500 });
  }
}
