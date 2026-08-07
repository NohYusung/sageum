import type { Folder } from './types';
import { parseFolderName } from './validation';

export type FolderUploadEntry = {
  file: File;
  relativePath: string;
};

export type PlannedFolderUploadFile = {
  file: File;
  directoryPath: string[];
};

export type FolderUploadPlan = {
  rootName: string;
  directories: string[][];
  files: PlannedFolderUploadFile[];
};

export type EnsuredFolderUploadTree = {
  folders: Folder[];
  folderIdsByPath: Map<string, string>;
  rootFolderId: string;
};

function normalizeSegment(segment: string) {
  if (segment === '.' || segment === '..') {
    throw new Error('상위 경로를 포함한 폴더는 업로드할 수 없습니다.');
  }
  return parseFolderName(segment.normalize('NFC'));
}

function normalizedFolderName(name: string) {
  return name.normalize('NFC').toLocaleLowerCase('ko-KR');
}

export function folderUploadPathKey(path: string[]) {
  return JSON.stringify(path.map((segment) => normalizedFolderName(segment)));
}

export function buildFolderUploadPlan(entries: FolderUploadEntry[]): FolderUploadPlan {
  if (!entries.length) throw new Error('업로드할 폴더에 파일이 없습니다.');

  const files = entries.map(({ file, relativePath }) => {
    if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\0')) {
      throw new Error('선택한 폴더의 상대 경로를 확인할 수 없습니다.');
    }
    const rawSegments = relativePath.split('/');
    if (rawSegments.length < 2 || rawSegments.some((segment) => !segment)) {
      throw new Error('선택한 폴더의 상대 경로가 올바르지 않습니다.');
    }
    const directoryPath = rawSegments.slice(0, -1).map(normalizeSegment);
    return { file, directoryPath };
  });

  const roots = new Map<string, string>();
  files.forEach(({ directoryPath }) => {
    roots.set(normalizedFolderName(directoryPath[0]), directoryPath[0]);
  });
  if (roots.size !== 1) {
    throw new Error('폴더는 한 번에 하나씩 선택해 주세요.');
  }

  const directoryMap = new Map<string, string[]>();
  files.forEach(({ directoryPath }) => {
    for (let depth = 1; depth <= directoryPath.length; depth += 1) {
      const path = directoryPath.slice(0, depth);
      directoryMap.set(folderUploadPathKey(path), path);
    }
  });
  const directories = [...directoryMap.values()].sort((left, right) => (
    left.length - right.length
    || left.join('/').localeCompare(right.join('/'), 'ko-KR', {
      numeric: true,
      sensitivity: 'base',
    })
  ));

  return {
    rootName: directories[0][0],
    directories,
    files,
  };
}

export async function ensureFolderUploadTree({
  plan,
  destinationFolderId,
  existingFolders,
  create,
}: {
  plan: FolderUploadPlan;
  destinationFolderId: string | null;
  existingFolders: Folder[];
  create: (name: string, parentId: string | null) => Promise<Folder>;
}): Promise<EnsuredFolderUploadTree> {
  const folders = [...existingFolders];
  const folderIdsByPath = new Map<string, string>();

  for (const path of plan.directories) {
    const parentPath = path.slice(0, -1);
    const parentId = parentPath.length
      ? folderIdsByPath.get(folderUploadPathKey(parentPath))
      : destinationFolderId;
    if (parentId === undefined) {
      throw new Error('상위 폴더를 생성하지 못했습니다.');
    }

    const name = path.at(-1)!;
    let folder = folders.find((candidate) => (
      candidate.parentId === parentId
      && normalizedFolderName(candidate.name) === normalizedFolderName(name)
    ));
    if (!folder) {
      folder = await create(name, parentId);
      folders.push(folder);
    }
    folderIdsByPath.set(folderUploadPathKey(path), folder.id);
  }

  const rootFolderId = folderIdsByPath.get(folderUploadPathKey([plan.rootName]));
  if (!rootFolderId) throw new Error('선택한 폴더를 생성하지 못했습니다.');

  return { folders, folderIdsByPath, rootFolderId };
}

function fileFromEntry(entry: FileSystemFileEntry) {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryEntries(entry: FileSystemDirectoryEntry) {
  return new Promise<FileSystemEntry[]>((resolve, reject) => {
    const reader = entry.createReader();
    const entries: FileSystemEntry[] = [];
    const readNext = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readNext();
      }, reject);
    };
    readNext();
  });
}

async function filesFromEntry(
  entry: FileSystemEntry,
  parentPath: string[] = [],
): Promise<FolderUploadEntry[]> {
  const path = [...parentPath, entry.name];
  if (entry.isFile) {
    const file = await fileFromEntry(entry as FileSystemFileEntry);
    return [{ file, relativePath: path.join('/') }];
  }
  const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
  const nested = await Promise.all(children.map((child) => filesFromEntry(child, path)));
  return nested.flat();
}

export async function folderUploadEntriesFromDrop(dataTransfer: DataTransfer) {
  const roots = Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (!roots.some((entry) => entry.isDirectory)) return null;
  const nested = await Promise.all(roots.map((entry) => filesFromEntry(entry)));
  return nested.flat();
}
