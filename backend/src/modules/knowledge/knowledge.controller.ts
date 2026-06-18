import { Controller, Get, Post, Param, Query, Body, UseGuards, Delete } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { KnowledgeService } from './knowledge.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Public } from '../../common/decorators/roles.decorator';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private knowledgeService: KnowledgeService) {}

  @Post('upload')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  upload(@Body() body: { content: string; title: string; sourceType?: string }) {
    return this.knowledgeService.upload(body.content, body.title, body.sourceType);
  }

  @Post('reindex')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  reindex() {
    return this.knowledgeService.reindex();
  }

  @Get('search')
  @Public()
  search(@Query('q') query: string, @Query('limit') limit = 5) {
    return this.knowledgeService.search(query, +limit);
  }

  // Structured retrieval result: { query, intent, retrieval_strategy, used_chunks[] }
  // with per-chunk citations (doc_id, chunk_id, title, category, relevance).
  @Get('search/detailed')
  @Public()
  searchDetailed(@Query('q') query: string, @Query('limit') limit = 5) {
    return this.knowledgeService.searchDetailed(query, +limit);
  }

  // Full RAG answer: intent-routed + filtered + reranked retrieval, then a
  // grounded Groq completion. Returns { query, intent, retrieval_strategy,
  // final_answer, used_chunks[] }.
  @Get('ask')
  @Public()
  ask(@Query('q') query: string, @Query('limit') limit = 4) {
    return this.knowledgeService.ask(query, +limit);
  }

  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  findAll() {
    return this.knowledgeService.findAll();
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  remove(@Param('id') id: string) {
    return this.knowledgeService.remove(id);
  }
}