import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { BcmrMetadata } from '@app/interfaces/bcmr-api.interface';
import { StateService } from '@app/services/state.service';

interface CacheEntry {
  data: BcmrMetadata;
  expiry: number;
}

@Injectable({
  providedIn: 'root',
})
export class BcmrService {
  private cache = new Map<string, CacheEntry>();
  private failedCategories = new Set<string>();
  private readonly CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
  private readonly FAILED_DURATION = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
  private failedCategoriesTimestamp = 0; // When the failed categories were last cleared

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService
  ) {}

  /**
   * Retrieve BCMR metadata details from a token id (from both FTs and NFTs).
   *
   * @param category Cash token id (hex). eg. b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366
   */
  getBcmrMetadata(category: string): Observable<BcmrMetadata> {
    // Clean expired cache entries first
    this.cleanExpiredCache();

    if (this.failedCategories.size > 0) {
      // Check if failed categories need to be cleared
      const now = Date.now();
      if (now - this.failedCategoriesTimestamp > this.FAILED_DURATION) {
        this.failedCategories.clear();
      }
      // Check if this category has failed before
      if (this.failedCategories.has(category)) {
        return throwError(() => new Error(`Category is in failed list`));
      }
    }

    // Check cache
    const cachedEntry = this.cache.get(category);
    if (cachedEntry) {
      return of(cachedEntry.data);
    }
    const apiURL = this.stateService.env.BCMR_API;

    // If not in cache, fetch from API and cache the result
    const httpOptions = {
      headers: { Accept: 'application/json', 'User-Agent': 'BCHExplorer/3.3' },
      responseType: 'json' as const,
    };
    // Slightly different end-points between different BCMR services
    const path = apiURL.includes('bcmr.paytaca.com') ? 'tokens/' : '';
    const extension = apiURL.includes('bcmr.flowee.cash') ? '.json' : '';
    return this.httpClient
      .get<BcmrMetadata>(
        `${apiURL}/${path}${encodeURIComponent(category)}${extension}`,
        httpOptions
      )
      .pipe(
        tap((data) => {
          // Save to cache
          this.setCache(category, data);
        }),
        catchError((error) => {
          // Set timestamp when adding first failed category
          if (this.failedCategories.size === 0) {
            this.failedCategoriesTimestamp = Date.now();
          }
          this.failedCategories.add(category);
          // Re-throw the error so the calling code can handle it
          return throwError(() => error);
        })
      );
  }

  /**
   * Store BCMR metadata in cache
   * @param category Token category
   * @param data BCMR metadata to cache
   */
  private setCache(category: string, data: BcmrMetadata): void {
    this.cache.set(category, {
      data,
      expiry: Date.now() + this.CACHE_DURATION,
    });
  }

  /**
   * Clean expired cache entries
   */
  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const category of this.cache.keys()) {
      if (this.cache.get(category)?.expiry <= now) {
        this.cache.delete(category);
      }
    }
  }
}
