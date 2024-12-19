import { injectable, inject } from 'inversify';
import { Client } from '@opensearch-project/opensearch'; // ^2.0.0
import { CircuitBreaker } from 'opossum'; // ^6.0.0
import { RedisService } from '../cache/redis.service';
import { IListing } from '../../interfaces/listing.interface';
import { Logger } from '../../utils/logger.util';
import { LISTING_STATUS } from '../../constants/status.constants';

/**
 * Interface for search parameters
 */
interface SearchParams {
  query?: string;
  filters?: {
    status?: LISTING_STATUS[];
    priceRange?: { min?: number; max?: number };
    categories?: string[];
    marketplaces?: string[];
    location?: {
      lat: number;
      lon: number;
      radius: number;
    };
  };
  sort?: {
    field: 'price' | 'createdAt' | 'relevance';
    order: 'asc' | 'desc';
  };
  page: number;
  limit: number;
}

/**
 * Service implementation for advanced listing search functionality
 * Provides full-text search, filtering, caching, and analytics tracking
 */
@injectable()
export class SearchService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly CIRCUIT_BREAKER_OPTIONS = {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
  };

  private circuitBreaker: CircuitBreaker;

  constructor(
    @inject('RedisService') private redisService: RedisService,
    @inject('OpenSearchClient') private searchClient: Client,
    @inject('Logger') private logger: Logger
  ) {
    this.initializeCircuitBreaker();
  }

  /**
   * Initialize circuit breaker for fault tolerance
   */
  private initializeCircuitBreaker(): void {
    this.circuitBreaker = new CircuitBreaker(
      async (params: SearchParams) => this.executeSearch(params),
      this.CIRCUIT_BREAKER_OPTIONS
    );

    this.circuitBreaker.on('open', () => {
      this.logger.error('Search circuit breaker opened - fallback to cache only');
    });
  }

  /**
   * Generate cache key based on search parameters
   */
  private generateCacheKey(params: SearchParams): string {
    return `search:${JSON.stringify(params)}`;
  }

  /**
   * Build OpenSearch query based on search parameters
   */
  private buildSearchQuery(params: SearchParams): any {
    const query: any = {
      bool: {
        must: [],
        filter: []
      }
    };

    // Full-text search
    if (params.query) {
      query.bool.must.push({
        multi_match: {
          query: params.query,
          fields: ['title^3', 'description^2', 'categories'],
          fuzziness: 'AUTO'
        }
      });
    }

    // Apply filters
    if (params.filters) {
      // Status filter
      if (params.filters.status?.length) {
        query.bool.filter.push({
          terms: { status: params.filters.status }
        });
      }

      // Price range filter
      if (params.filters.priceRange) {
        const range: any = {};
        if (params.filters.priceRange.min !== undefined) {
          range.gte = params.filters.priceRange.min;
        }
        if (params.filters.priceRange.max !== undefined) {
          range.lte = params.filters.priceRange.max;
        }
        if (Object.keys(range).length) {
          query.bool.filter.push({ range: { price: range } });
        }
      }

      // Categories filter
      if (params.filters.categories?.length) {
        query.bool.filter.push({
          terms: { categories: params.filters.categories }
        });
      }

      // Location filter
      if (params.filters.location) {
        query.bool.filter.push({
          geo_distance: {
            distance: `${params.filters.location.radius}km`,
            location: {
              lat: params.filters.location.lat,
              lon: params.filters.location.lon
            }
          }
        });
      }
    }

    return query;
  }

  /**
   * Execute search against OpenSearch
   */
  private async executeSearch(params: SearchParams): Promise<{
    listings: IListing[];
    total: number;
    facets: any;
  }> {
    const query = this.buildSearchQuery(params);
    const { page = 1, limit = 20 } = params;

    const searchBody = {
      query,
      from: (page - 1) * limit,
      size: limit,
      sort: this.buildSortCriteria(params.sort),
      aggs: {
        price_ranges: {
          range: {
            field: 'price',
            ranges: [
              { to: 50 },
              { from: 50, to: 200 },
              { from: 200, to: 1000 },
              { from: 1000 }
            ]
          }
        },
        categories: {
          terms: { field: 'categories', size: 20 }
        },
        marketplaces: {
          terms: { field: 'marketplaceSyncs.platform', size: 10 }
        }
      }
    };

    try {
      const response = await this.searchClient.search({
        index: 'listings',
        body: searchBody
      });

      return {
        listings: response.body.hits.hits.map((hit: any) => ({
          ...hit._source,
          score: hit._score
        })),
        total: response.body.hits.total.value,
        facets: {
          price_ranges: response.body.aggregations.price_ranges,
          categories: response.body.aggregations.categories,
          marketplaces: response.body.aggregations.marketplaces
        }
      };
    } catch (error) {
      this.logger.error('Search execution failed', { error, params });
      throw error;
    }
  }

  /**
   * Build sort criteria based on parameters
   */
  private buildSortCriteria(sort?: SearchParams['sort']): any[] {
    if (!sort) {
      return [{ _score: 'desc' }];
    }

    const sortCriteria: any[] = [];

    switch (sort.field) {
      case 'price':
        sortCriteria.push({ price: sort.order });
        break;
      case 'createdAt':
        sortCriteria.push({ createdAt: sort.order });
        break;
      case 'relevance':
        sortCriteria.push({ _score: sort.order });
        break;
    }

    return sortCriteria;
  }

  /**
   * Main search method with caching and circuit breaker protection
   */
  public async searchListings(params: SearchParams): Promise<{
    listings: IListing[];
    total: number;
    facets: any;
  }> {
    const cacheKey = this.generateCacheKey(params);

    try {
      // Check cache first
      const cachedResult = await this.redisService.get(cacheKey);
      if (cachedResult) {
        this.logger.info('Search cache hit', { params });
        return JSON.parse(cachedResult);
      }

      // Execute search with circuit breaker protection
      const result = await this.circuitBreaker.fire(params);

      // Cache the results
      await this.redisService.set(
        cacheKey,
        JSON.stringify(result),
        this.CACHE_TTL
      );

      // Track search analytics
      this.trackSearchAnalytics(params, result.total);

      return result;
    } catch (error) {
      this.logger.error('Search failed', { error, params });
      throw error;
    }
  }

  /**
   * Track search analytics for market trend analysis
   */
  private async trackSearchAnalytics(
    params: SearchParams,
    resultCount: number
  ): Promise<void> {
    try {
      const analyticsData = {
        timestamp: new Date().toISOString(),
        query: params.query,
        filters: params.filters,
        resultCount,
        page: params.page,
        limit: params.limit
      };

      // Queue analytics data for async processing
      await this.redisService.rpush(
        'search:analytics',
        JSON.stringify(analyticsData)
      );
    } catch (error) {
      this.logger.error('Failed to track search analytics', { error, params });
    }
  }
}