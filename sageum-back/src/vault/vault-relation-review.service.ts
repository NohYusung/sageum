import { Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { openVaultDatabase } from './vault-indexer.service';
import { VaultPathService } from './vault-path.service';

export type RelationReviewStatus = 'candidate' | 'approved' | 'rejected' | 'stale';

export type RelationReviewResult = {
  relationId: string;
  documentId: string;
  status: RelationReviewStatus;
  sidecarPath: string;
};

type RelationSidecar = {
  document_id?: string;
  relations?: Array<Record<string, unknown>>;
};

@Injectable()
export class VaultRelationReviewService {
  constructor(private readonly paths: VaultPathService) {}

  approve(relationId: string) {
    return this.updateStatus(relationId, 'approved');
  }

  reject(relationId: string) {
    return this.updateStatus(relationId, 'rejected');
  }

  markStale(relationId: string) {
    return this.updateStatus(relationId, 'stale');
  }

  private async updateStatus(relationId: string, status: RelationReviewStatus): Promise<RelationReviewResult> {
    const normalizedId = relationId.trim();
    if (!normalizedId) {
      throw new NotFoundException('relation not found');
    }
    const located = this.findRelation(normalizedId);
    if (!located) {
      throw new NotFoundException(`Relation not found: ${normalizedId}`);
    }

    located.relation.status = status;
    writeFileSync(this.paths.resolveInside(located.sidecarPath), `${JSON.stringify(located.payload, null, 2)}\n`, 'utf8');
    this.syncIndex(normalizedId, status);

    return {
      relationId: normalizedId,
      documentId: String(located.payload.document_id || ''),
      status,
      sidecarPath: located.sidecarPath,
    };
  }

  private findRelation(relationId: string) {
    const root = this.paths.resolveInside('.sageum/relations');
    if (!existsSync(root)) return null;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const sidecarPath = `.sageum/relations/${entry.name}`;
      const payload = JSON.parse(readFileSync(this.paths.resolveInside(sidecarPath), 'utf8')) as RelationSidecar;
      for (const relation of payload.relations ?? []) {
        if (String(relation.relation_id || '') === relationId) {
          return { sidecarPath, payload, relation };
        }
      }
    }
    return null;
  }

  private syncIndex(relationId: string, status: RelationReviewStatus) {
    const indexPath = this.paths.resolveInside(this.paths.config.indexPath);
    if (!existsSync(indexPath)) return;
    const db = openVaultDatabase(this.paths);
    try {
      db.prepare('UPDATE relations SET status = ? WHERE id = ?').run(status, relationId);
    } finally {
      db.close();
    }
  }
}
