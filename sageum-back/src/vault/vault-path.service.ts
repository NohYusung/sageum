import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export type VaultPathConfig = {
  vaultRoot: string;
  noteRoot: string;
  conceptRoot: string;
  sourceRoot: string;
  mapRoot: string;
  indexPath: string;
};

export const VAULT_PATH_CONFIG = 'SAGEUM_VAULT_PATH_CONFIG';

function envConfig(): VaultPathConfig {
  return {
    vaultRoot: process.env.SAGEUM_OBSIDIAN_VAULT_PATH ?? process.cwd(),
    noteRoot: process.env.SAGEUM_OBSIDIAN_NOTE_ROOT ?? '10_Notes',
    conceptRoot: process.env.SAGEUM_OBSIDIAN_CONCEPT_ROOT ?? '20_Concepts',
    sourceRoot: process.env.SAGEUM_OBSIDIAN_SOURCE_ROOT ?? '30_Sources',
    mapRoot: process.env.SAGEUM_OBSIDIAN_MAP_ROOT ?? '40_Maps',
    indexPath: process.env.SAGEUM_INDEX_PATH ?? '.sageum/index.sqlite',
  };
}

@Injectable()
export class VaultPathService {
  readonly config: VaultPathConfig;
  readonly root: string;

  constructor(@Optional() @Inject(VAULT_PATH_CONFIG) config: Partial<VaultPathConfig> = {}) {
    this.config = { ...envConfig(), ...config };
    this.root = resolve(this.config.vaultRoot);
  }

  ensureVaultRoot() {
    if (!existsSync(this.root)) {
      throw new BadRequestException(`Obsidian vault root does not exist: ${this.root}`);
    }
  }

  resolveInside(relativePath: string) {
    if (!relativePath || isAbsolute(relativePath)) {
      throw new BadRequestException('path must be relative to vault root');
    }
    const resolved = resolve(this.root, relativePath);
    const diff = relative(this.root, resolved);
    if (diff === '..' || diff.startsWith(`..${sep}`) || isAbsolute(diff)) {
      throw new BadRequestException('path resolves outside vault root');
    }
    return resolved;
  }

  ensureDirectory(relativePath: string) {
    const resolved = this.resolveInside(relativePath);
    mkdirSync(resolved, { recursive: true });
    return resolved;
  }

  toVaultPath(absolutePath: string) {
    const diff = relative(this.root, absolutePath);
    if (diff === '..' || diff.startsWith(`..${sep}`) || isAbsolute(diff)) {
      throw new BadRequestException('path resolves outside vault root');
    }
    return diff.split(sep).join('/');
  }
}
