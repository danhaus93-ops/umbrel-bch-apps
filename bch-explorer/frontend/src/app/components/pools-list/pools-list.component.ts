import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  LOCALE_ID,
  OnInit,
} from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, share, tap } from 'rxjs/operators';
import { ApiService } from '@app/services/api.service';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { HttpErrorResponse } from '@angular/common/http';

export interface PoolData {
  poolId: number;
  name: string;
  link: string;
  blockCount: number;
  rank: number;
  emptyBlocks: number;
  slug: string;
  avgMatchRate: number | null;
  avgFeeDelta: number | null;
  poolUniqueId: number;
  logo: string;
  share?: number;
}

export interface PoolsResponse {
  pools: PoolData[];
  blockCount: number;
  lastEstimatedHashrate: number;
  lastEstimatedHashrate3d: number;
  lastEstimatedHashrate1w: number;
}

@Component({
  selector: 'app-pools-list',
  templateUrl: './pools-list.component.html',
  styleUrls: ['./pools-list.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PoolsListComponent implements OnInit {
  pools$: Observable<PoolData[]>;
  isLoading = true;
  error: HttpErrorResponse | null = null;
  skeletonLines: number[] = [...Array(15).keys()];
  auditAvailable = false;

  constructor(
    @Inject(LOCALE_ID) public locale: string,
    private apiService: ApiService,
    public stateService: StateService,
    private seoService: SeoService
  ) {}

  ngOnInit(): void {
    this.auditAvailable =
      this.stateService.env.BASE_MODULE === 'explorer' &&
      this.stateService.env.MINING_DASHBOARD === true &&
      this.stateService.env.AUDIT === true;

    this.seoService.setTitle($localize`Mining Pools`);
    this.seoService.setDescription(
      $localize`Overview of the mining pools on Bitcoin Cash.`
    );

    this.pools$ = this.apiService.listPools$('all').pipe(
      map((response) => {
        const poolsResponse: PoolsResponse = response.body;
        const totalBlocks = poolsResponse.blockCount;
        return poolsResponse.pools.map((pool) => ({
          ...pool,
          logo: `/resources/mining-pools/${pool.slug}.svg`,
          share: totalBlocks > 0 ? (pool.blockCount / totalBlocks) * 100 : 0,
        }));
      }),
      tap(() => {
        this.isLoading = false;
      }),
      catchError((error) => {
        this.error = error;
        this.isLoading = false;
        this.seoService.logSoft404();
        return of([]);
      }),
      share()
    );
  }

  trackByPool(index: number, pool: PoolData): number {
    return pool.poolId;
  }

  isMobile(): boolean {
    return window.innerWidth <= 767.98;
  }
}
