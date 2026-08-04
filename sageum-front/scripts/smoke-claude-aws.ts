import { generateClaudeGroundedAnswer } from '../src/lib/server/claude-rag-answer';
import { getProviderConfiguration } from '../src/lib/server/env';

async function main() {
  const providers = getProviderConfiguration();
  if (!providers.generation.configured) {
    throw new Error(
      'ANTHROPIC_AWS_WORKSPACE_ID, AWS_REGION, ANTHROPIC_AWS_API_KEY 또는 SigV4 자격증명을 설정해 주세요.',
    );
  }

  const result = await generateClaudeGroundedAnswer(
    '재택근무는 일주일에 몇 번 가능한가요?',
    [{
      documentId: 'smoke-document',
      versionId: 'smoke-version',
      documentTitle: '한국어 사내 규정',
      chunkId: 'smoke-work-policy',
      heading: '근무 제도',
      snippet: '직원은 일주일에 이틀까지 자택에서 근무할 수 있습니다.',
      score: 0.99,
      page: 2,
      sourceSpans: [],
    }],
  );

  if (result.insufficientEvidence || result.sources[0]?.chunkId !== 'smoke-work-policy') {
    throw new Error('Claude가 제공된 근거를 사용한 답변과 인용을 반환하지 못했습니다.');
  }

  console.log(
    `Claude Platform on AWS 스모크 테스트 통과: ${providers.generation.model} (${providers.generation.region}, ${providers.generation.auth}).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Claude Platform on AWS 스모크 테스트에 실패했습니다.');
  process.exitCode = 1;
});
