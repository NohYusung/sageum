export type RepositoryDeletionFolder = {
  id: string;
  parentId: string | null;
};

export type RepositoryDeletionDocument = {
  id: string;
  folderId: string | null;
};

export type RepositoryDeletionTargets = {
  documentIds: string[];
  folderDocumentIds: string[];
  folderIds: string[];
  rootFolderIds: string[];
};

function uniqueIds(ids: Iterable<string>) {
  return [...new Set(ids)];
}

export function resolveRepositoryDeletionTargets({
  documents,
  folders,
  selectedDocumentIds,
  selectedFolderIds,
}: {
  documents: RepositoryDeletionDocument[];
  folders: RepositoryDeletionFolder[];
  selectedDocumentIds: Iterable<string>;
  selectedFolderIds: Iterable<string>;
}): RepositoryDeletionTargets {
  const directFolderIds = uniqueIds(selectedFolderIds);
  const directFolderIdSet = new Set(directFolderIds);
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const childrenByParent = new Map<string, string[]>();

  folders.forEach((folder) => {
    if (!folder.parentId) return;
    const children = childrenByParent.get(folder.parentId) ?? [];
    children.push(folder.id);
    childrenByParent.set(folder.parentId, children);
  });

  const folderIds = new Set<string>();
  const queue = [...directFolderIds];
  while (queue.length) {
    const folderId = queue.shift()!;
    if (folderIds.has(folderId) || !foldersById.has(folderId)) continue;
    folderIds.add(folderId);
    queue.push(...(childrenByParent.get(folderId) ?? []));
  }

  const rootFolderIds = directFolderIds.filter((folderId) => {
    let parentId = foldersById.get(folderId)?.parentId ?? null;
    const visited = new Set<string>();
    while (parentId) {
      if (visited.has(parentId)) break;
      if (directFolderIdSet.has(parentId)) return false;
      visited.add(parentId);
      parentId = foldersById.get(parentId)?.parentId ?? null;
    }
    return foldersById.has(folderId);
  });

  const folderDocumentIds = documents
    .filter((document) => document.folderId && folderIds.has(document.folderId))
    .map((document) => document.id);
  const documentIds = uniqueIds([
    ...selectedDocumentIds,
    ...folderDocumentIds,
  ]);

  return {
    documentIds,
    folderDocumentIds,
    folderIds: [...folderIds],
    rootFolderIds,
  };
}
