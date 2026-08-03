export type FailedDocumentVersionCleanupOperations = {
  deleteChunks: () => Promise<void>;
  markFailed: (message: string) => Promise<void>;
};

export async function cleanupFailedDocumentVersion(
  message: string,
  operations: FailedDocumentVersionCleanupOperations,
) {
  try {
    await operations.deleteChunks();
  } catch (error) {
    console.error('Failed to clean up document chunks after processing failure', error);
  }

  try {
    await operations.markFailed(message);
  } catch (error) {
    console.error('Failed to mark document version as failed', error);
  }
}
