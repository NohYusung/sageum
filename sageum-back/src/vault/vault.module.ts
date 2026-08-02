import { Module } from '@nestjs/common';
import { VaultController } from './vault.controller';
import { VaultIndexerService } from './vault-indexer.service';
import { VaultPathService } from './vault-path.service';
import { VaultRelationReviewService } from './vault-relation-review.service';
import { VaultSearchService } from './vault-search.service';
import { VaultService } from './vault.service';

@Module({
  controllers: [VaultController],
  providers: [VaultPathService, VaultService, VaultIndexerService, VaultSearchService, VaultRelationReviewService],
  exports: [VaultService],
})
export class VaultModule {}
