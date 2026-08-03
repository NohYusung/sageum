export type DocumentDeletionJob = {
  jobId: string;
  storagePaths: string[];
  requiresVectorCleanup: boolean;
};

export type DocumentDeletionOperations = {
  deleteVectors: () => Promise<void>;
  deleteStorage: (paths: string[]) => Promise<void>;
  complete: () => Promise<void>;
  markFailed: (message: string) => Promise<void>;
};

function deletionFailureMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.slice(0, 500);
  return '문서 외부 리소스 삭제에 실패했습니다.';
}

export async function cleanupDocumentDeletion(
  job: DocumentDeletionJob,
  operations: DocumentDeletionOperations,
) {
  try {
    await operations.deleteVectors();
    if (job.storagePaths.length) await operations.deleteStorage(job.storagePaths);
    await operations.complete();
  } catch (error) {
    try {
      await operations.markFailed(deletionFailureMessage(error));
    } catch (markError) {
      console.error('Failed to persist document deletion failure', markError);
    }
    throw error;
  }
}
