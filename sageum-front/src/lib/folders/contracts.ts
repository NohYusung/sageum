import type { Folder } from './types';

export type FolderResponse = {
  folder: Folder;
};

export type DocumentMoveResponse = {
  documentId: string;
  folderId: string | null;
};
