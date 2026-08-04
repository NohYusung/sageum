import type { IndexedDocument } from '@/lib/rag/local-search';
import type { Folder, FolderTreeNode } from './types';

function compareFolders(left: Folder, right: Folder) {
  return left.sortOrder - right.sortOrder
    || left.name.localeCompare(right.name, 'ko-KR', { numeric: true, sensitivity: 'base' });
}

export function flattenFolderTree(folders: Folder[]): FolderTreeNode[] {
  const childrenByParent = new Map<string | null, Folder[]>();
  folders.forEach((folder) => {
    const children = childrenByParent.get(folder.parentId) ?? [];
    children.push(folder);
    childrenByParent.set(folder.parentId, children);
  });
  childrenByParent.forEach((children) => children.sort(compareFolders));

  const flattened: FolderTreeNode[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of childrenByParent.get(parentId) ?? []) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      flattened.push({ ...folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);

  // Keep malformed orphan rows visible instead of making them unreachable in the UI.
  folders.toSorted(compareFolders).forEach((folder) => {
    if (!visited.has(folder.id)) flattened.push({ ...folder, depth: 0 });
  });
  return flattened;
}

export function folderPath(folders: Folder[], folderId: string | null) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: Folder[] = [];
  const visited = new Set<string>();
  let currentId = folderId;
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const folder = byId.get(currentId);
    if (!folder) break;
    path.unshift(folder);
    currentId = folder.parentId;
  }
  return path;
}

export function descendantFolderIds(folders: Folder[], folderId: string) {
  const childrenByParent = new Map<string, string[]>();
  folders.forEach((folder) => {
    if (!folder.parentId) return;
    const children = childrenByParent.get(folder.parentId) ?? [];
    children.push(folder.id);
    childrenByParent.set(folder.parentId, children);
  });
  const ids = new Set<string>();
  const queue = [folderId];
  while (queue.length) {
    const current = queue.shift()!;
    if (ids.has(current)) continue;
    ids.add(current);
    queue.push(...(childrenByParent.get(current) ?? []));
  }
  return ids;
}

export function documentsInFolderScope(
  documents: IndexedDocument[],
  folders: Folder[],
  folderId: string | null,
  { recursive = false } = {},
) {
  if (!folderId) return documents.filter(({ document }) => !document.folderId);
  if (!recursive) {
    return documents.filter(({ document }) => document.folderId === folderId);
  }
  const folderIds = descendantFolderIds(folders, folderId);
  return documents.filter(({ document }) => (
    document.folderId ? folderIds.has(document.folderId) : false
  ));
}

export function canMoveFolder(folders: Folder[], folderId: string, targetParentId: string | null) {
  if (!targetParentId) return true;
  return !descendantFolderIds(folders, folderId).has(targetParentId);
}
