type DatabaseError = {
  code?: string;
  message?: string;
};

export function folderDatabaseError(error: DatabaseError, fallback: string) {
  if (error.code === '23505') return '같은 위치에 동일한 이름의 폴더가 있습니다.';
  if (error.code === '23503') return '비어 있지 않은 폴더는 삭제할 수 없습니다.';
  if (error.code === '23514') return '폴더를 자기 자신이나 하위 폴더로 이동할 수 없습니다.';
  if (error.code === 'P0002') return '폴더 또는 문서를 찾을 수 없습니다.';
  return fallback;
}
