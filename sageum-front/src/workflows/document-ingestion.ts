import { FatalError, getStepMetadata } from 'workflow';
import {
  DocumentIngestionProcessingError,
  processDocumentIngestion,
  type DocumentIngestionInput,
} from '@/lib/server/document-ingestion';

const MAX_RETRIES = 3;

async function processDocumentStep(input: DocumentIngestionInput) {
  'use step';

  const metadata = getStepMetadata();
  try {
    await processDocumentIngestion({
      ...input,
      processingToken: metadata.stepId,
      finalAttempt: metadata.attempt >= MAX_RETRIES + 1,
    });
  } catch (error) {
    if (error instanceof DocumentIngestionProcessingError && !error.retryable) {
      throw new FatalError(error.message);
    }
    throw error;
  }
}

processDocumentStep.maxRetries = MAX_RETRIES;

export async function documentIngestionWorkflow(input: DocumentIngestionInput) {
  'use workflow';

  await processDocumentStep(input);
  return { jobId: input.jobId, documentId: input.documentId, versionId: input.versionId };
}
