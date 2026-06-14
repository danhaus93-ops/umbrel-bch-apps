import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  HostListener,
  Inject,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
} from '@angular/core';
import {
  combineLatest,
  merge,
  Observable,
  of,
  Subject,
  Subscription,
} from 'rxjs';
import {
  catchError,
  filter,
  map,
  scan,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';
import {
  AuditStatus,
  BlockExtended,
  OptimizedMempoolStats,
} from '@interfaces/node-api.interface';
import { MempoolInfo } from '@interfaces/websocket.interface';
import { ApiService } from '@app/services/api.service';
import { StateService } from '@app/services/state.service';
import { WebsocketService } from '@app/services/websocket.service';
import { SeoService } from '@app/services/seo.service';
import {
  ActiveFilter,
  FilterMode,
  GradientMode,
  toFlags,
} from '@app/shared/filters.utils';
import { detectWebGL } from '@app/shared/graphs.utils';

interface MempoolBlocksData {
  blocks: number;
  size: number;
}

interface MempoolInfoData {
  memPoolInfo: MempoolInfo;
  bytesPerSecond: number;
  mempoolSizeProgressClass: string;
}

interface MempoolStatsData {
  mempool: OptimizedMempoolStats[];
  bytesPerSecond: any;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit, OnDestroy, AfterViewInit {
  network$: Observable<string>;
  mempoolBlocksData$: Observable<MempoolBlocksData>;
  mempoolInfoData$: Observable<MempoolInfoData>;
  mempoolLoadingStatus$: Observable<number>;
  bytesPerSecondLimit = 1667;
  blocks$: Observable<BlockExtended[]>;
  latestBlockHeight: number;
  mempoolStats$: Observable<MempoolStatsData>;
  isLoadingWebSocket$: Observable<boolean>;
  auditStatus$: Observable<AuditStatus>;
  auditUpdated$: Observable<boolean>;
  isLoad: boolean = true;
  filterSubscription: Subscription;
  mempoolInfoSubscription: Subscription;
  currencySubscription: Subscription;
  currency: string;
  incomingGraphHeight: number = 300;
  lbtcPegGraphHeight: number = 360;
  webGlEnabled = true;

  goggleResolution = 82;
  goggleCycle: {
    index: number;
    name: string;
    mode: FilterMode;
    filters: string[];
    gradient: GradientMode;
  }[] = [
    {
      index: 0,
      name: $localize`:@@dfc3c34e182ea73c5d784ff7c8135f087992dac1:All`,
      mode: 'and',
      filters: [],
      gradient: 'age',
    },
    {
      index: 1,
      name: $localize`Consolidation`,
      mode: 'and',
      filters: ['consolidation'],
      gradient: 'fee',
    },
    {
      index: 2,
      name: $localize`Coinjoin`,
      mode: 'and',
      filters: ['coinjoin'],
      gradient: 'fee',
    },
    {
      index: 3,
      name: $localize`Data`,
      mode: 'or',
      filters: ['inscription', 'fake_pubkey', 'fake_scripthash', 'op_return'],
      gradient: 'fee',
    },
  ];
  goggleFlags = 0n;
  goggleMode: FilterMode = 'and';
  gradientMode: GradientMode = 'age';
  goggleIndex = 0;

  private destroy$ = new Subject();

  constructor(
    public stateService: StateService,
    private apiService: ApiService,
    private websocketService: WebsocketService,
    private seoService: SeoService,
    @Inject(PLATFORM_ID) private platformId: object
  ) {
    this.webGlEnabled = this.stateService.isBrowser && detectWebGL();
  }

  ngAfterViewInit(): void {
    this.stateService.focusSearchInputDesktop();
  }

  ngOnDestroy(): void {
    this.filterSubscription.unsubscribe();
    this.mempoolInfoSubscription.unsubscribe();
    this.currencySubscription.unsubscribe();
    this.destroy$.next(1);
    this.destroy$.complete();
  }

  ngOnInit(): void {
    this.onResize();
    this.isLoadingWebSocket$ = this.stateService.isLoadingWebSocket$;
    this.seoService.resetTitle();
    this.seoService.resetDescription();
    this.websocketService.want([
      'blocks',
      'stats',
      'mempool-blocks',
      'live-2h-chart',
    ]);
    this.network$ = merge(of(''), this.stateService.networkChanged$);
    this.mempoolLoadingStatus$ = this.stateService.loadingIndicators$.pipe(
      map((indicators) =>
        indicators['mempool'] !== undefined ? indicators['mempool'] : 100
      )
    );

    this.filterSubscription = this.stateService.activeGoggles$.subscribe(
      (active: ActiveFilter) => {
        const activeFilters = active.filters.sort().join(',');
        for (const goggle of this.goggleCycle) {
          if (goggle.mode === active.mode) {
            const goggleFilters = goggle.filters.sort().join(',');
            if (goggleFilters === activeFilters) {
              this.goggleIndex = goggle.index;
              this.goggleFlags = toFlags(goggle.filters);
              this.goggleMode = goggle.mode;
              this.gradientMode = active.gradient;
              return;
            }
          }
        }
        this.goggleCycle.push({
          index: this.goggleCycle.length,
          name: 'Custom',
          mode: active.mode,
          filters: active.filters,
          gradient: active.gradient,
        });
        this.goggleIndex = this.goggleCycle.length - 1;
        this.goggleFlags = toFlags(active.filters);
        this.goggleMode = active.mode;
      }
    );

    this.mempoolInfoData$ = combineLatest([
      this.stateService.mempoolInfo$,
      this.stateService.bytesPerSecond$,
    ]).pipe(
      map(([mempoolInfo, bytesPerSecond]) => {
        const percent = Math.round(
          (Math.min(bytesPerSecond, this.bytesPerSecondLimit) /
            this.bytesPerSecondLimit) *
            100
        );
        const mempoolSizePercentage =
          (mempoolInfo.usage / mempoolInfo.maxmempool) * 100;
        let mempoolSizeProgressClass = 'bg-danger';
        if (mempoolSizePercentage <= 50) {
          mempoolSizeProgressClass = 'bg-success';
        } else if (mempoolSizePercentage <= 75) {
          mempoolSizeProgressClass = 'bg-warning';
        }

        return {
          memPoolInfo: mempoolInfo,
          bytesPerSecond: bytesPerSecond,
          mempoolSizeProgressClass: mempoolSizeProgressClass,
        };
      })
    );

    this.mempoolInfoSubscription = this.mempoolInfoData$.subscribe();

    this.mempoolBlocksData$ = this.stateService.mempoolBlocks$.pipe(
      map((mempoolBlocks) => {
        const size = mempoolBlocks
          .map((m) => m.blockSize)
          .reduce((a, b) => a + b, 0);
        return {
          size: size,
          blocks: Math.ceil(size / this.stateService.blockSize),
        };
      })
    );

    this.blocks$ = this.stateService.blocks$.pipe(
      tap((blocks) => {
        this.latestBlockHeight = blocks[0].height;
      }),
      switchMap((blocks) => {
        if (this.stateService.env.MINING_DASHBOARD === true) {
          for (const block of blocks) {
            // @ts-ignore: Need to add an extra field for the template
            block.extras.pool.logo =
              `/resources/mining-pools/` + block.extras.pool.slug + '.svg';
          }
        }
        return of(blocks.slice(0, 6));
      })
    );

    this.mempoolStats$ = this.stateService.connectionState$.pipe(
      filter((state) => state === 2),
      switchMap(() =>
        this.apiService.list2HStatistics$().pipe(
          catchError((e) => {
            return of(null);
          })
        )
      ),
      switchMap((mempoolStats) => {
        return merge(
          this.stateService.live2Chart$.pipe(
            scan((acc, stats) => {
              const now = Date.now() / 1000;
              const start = now - 2 * 60 * 60;
              acc.unshift(stats);
              acc = acc.filter((p) => p.added >= start);
              return acc;
            }, mempoolStats || [])
          ),
          of(mempoolStats)
        );
      }),
      map((mempoolStats) => {
        if (mempoolStats) {
          return {
            mempool: mempoolStats,
            bytesPerSecond: this.handleNewMempoolData(mempoolStats.concat([])),
          };
        } else {
          return null;
        }
      }),
      shareReplay(1)
    );

    this.currencySubscription = this.stateService.fiatCurrency$.subscribe(
      (fiat) => {
        this.currency = fiat;
      }
    );
  }

  handleNewMempoolData(mempoolStats: OptimizedMempoolStats[]) {
    mempoolStats.reverse();
    const labels = mempoolStats.map((stats) => stats.added);

    return {
      labels: labels,
      series: [
        mempoolStats.map((stats) => [
          stats.added * 1000,
          stats.bytes_per_second,
        ]),
      ],
    };
  }

  trackByBlock(index: number, block: BlockExtended) {
    return block.height;
  }

  getArrayFromNumber(num: number): number[] {
    return Array.from({ length: num }, (_, i) => i + 1);
  }

  setFilter(index): void {
    const selected = this.goggleCycle[index];
    this.stateService.activeGoggles$.next(selected);
  }

  @HostListener('window:resize')
  onResize(): void {
    if (window.innerWidth >= 992) {
      this.incomingGraphHeight = 300;
      this.goggleResolution = 82;
      this.lbtcPegGraphHeight = 360;
    } else if (window.innerWidth >= 768) {
      this.incomingGraphHeight = 215;
      this.goggleResolution = 80;
      this.lbtcPegGraphHeight = 270;
    } else {
      this.incomingGraphHeight = 180;
      this.goggleResolution = 86;
      this.lbtcPegGraphHeight = 270;
    }
  }
}
