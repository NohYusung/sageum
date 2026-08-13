import type { ManualRuleMutationResponse } from '@/lib/relations/types';
import { ManualRuleValidationError } from '@/lib/relations/manual-rule';
import { getAuthenticatedRequestContext } from '@/lib/server/api-auth';
import {
  ManualRuleDocumentError,
  reviseManualRuleDocument,
} from '@/lib/server/manual-rule-document';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const context = await getAuthenticatedRequestContext();
  if (!context) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const { documentId } = await params;
  if (!UUID_PATTERN.test(documentId)) {
    return Response.json({ error: '올바른 규칙 문서 식별자가 필요합니다.' }, { status: 400 });
  }

  const body = await request.json().catch(() => null) as { content?: unknown } | null;
  try {
    const result = await reviseManualRuleDocument(context.ownerId, documentId, body?.content);
    return Response.json(result satisfies ManualRuleMutationResponse, { status: 202 });
  } catch (error) {
    if (error instanceof ManualRuleValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ManualRuleDocumentError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to revise a manual rule document', error);
    return Response.json({ error: '직접 입력 규칙을 수정하지 못했습니다.' }, { status: 500 });
  }
}
