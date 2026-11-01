import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { searchQuerySchema, type SearchResponse } from '@lead/schema';
import { CurrentUserRow } from '../auth/auth.guard';
import { parseBody } from '../auth/http';
import type { UserRow } from '../database/schema';
import { SearchService } from './search.service';

/** H09 Permission-scoped search, for every signed-in role (scoped inside the service). */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Matching words inside lesson text scans every lesson in scope, so searches are rationed. */
  @Get()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  find(@Query() query: unknown, @CurrentUserRow() user: UserRow): Promise<SearchResponse> {
    const { q } = parseBody(searchQuerySchema, query, 'Type at least 2 characters to search.');
    return this.search.search(user, q);
  }
}
