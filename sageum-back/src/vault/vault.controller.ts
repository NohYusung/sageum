import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SearchVaultDto } from './dto/search-vault.dto';
import { SaveDocumentDto } from './dto/save-document.dto';
import { VaultIndexerService } from './vault-indexer.service';
import { VaultRelationReviewService } from './vault-relation-review.service';
import { VaultSearchService } from './vault-search.service';
import { VaultService } from './vault.service';

@Controller('vault')
export class VaultController {
  constructor(
    private readonly vault: VaultService,
    private readonly indexer: VaultIndexerService,
    private readonly searcher: VaultSearchService,
    private readonly relationReview: VaultRelationReviewService,
  ) {}

  @Post('documents')
  async saveDocument(@Body() dto: SaveDocumentDto) {
    const saved = await this.vault.saveDocument(dto);
    const index = await this.indexer.rebuild();
    return { ...saved, index };
  }

  @Post('index')
  rebuildIndex() {
    return this.indexer.rebuild();
  }

  @Get('index/status')
  indexStatus() {
    return this.indexer.status();
  }

  @Get('search')
  search(@Query() dto: SearchVaultDto) {
    return this.searcher.search(dto.q);
  }

  @Post('relations/:relationId/approve')
  approveRelation(@Param('relationId') relationId: string) {
    return this.relationReview.approve(relationId);
  }

  @Post('relations/:relationId/reject')
  rejectRelation(@Param('relationId') relationId: string) {
    return this.relationReview.reject(relationId);
  }
}
