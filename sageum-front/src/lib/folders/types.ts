export type Folder = {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type FolderTreeNode = Folder & {
  depth: number;
};
