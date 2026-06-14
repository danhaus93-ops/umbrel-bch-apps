import {
  Component,
  OnInit,
  OnDestroy,
  ViewChildren,
  QueryList,
  ChangeDetectorRef,
} from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, ParamMap, Params, Router } from '@angular/router';
import { Transaction, Vout } from '@app/interfaces/backend-api.interface';
import { ElectrsApiService } from '@app/services/backend-api.service';
import {
  switchMap,
  tap,
  throttleTime,
  catchError,
  map,
  shareReplay,
  startWith,
} from 'rxjs/operators';
import {
  Observable,
  of,
  Subscription,
  asyncScheduler,
  EMPTY,
  combineLatest,
  forkJoin,
} from 'rxjs';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { WebsocketService } from '@app/services/websocket.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import {
  BlockAudit,
  BlockExtended,
  TransactionStripped,
} from '@interfaces/node-api.interface';
import { ApiService } from '@app/services/api.service';
import { BlockOverviewGraphComponent } from '@components/block-overview-graph/block-overview-graph.component';
import { detectWebGL } from '@app/shared/graphs.utils';
import { seoDescriptionNetwork } from '@app/shared/common.utils';
import { PriceService, Price } from '@app/services/price.service';
import { CacheService } from '@app/services/cache.service';
import { PreloadService } from '@app/services/preload.service';
import { specialBlocks } from '@app/app.constants';

interface ComparisonStats {
  totalFees: number;
  totalSize: number;
  txCount: number;
  feeDelta: number;
  sizeDelta: number;
  txDelta: number;
}

@Component({
  selector: 'app-block',
  templateUrl: './block.component.html',
  standalone: false,
  styleUrls: ['./block.component.scss'],
  styles: [
    `
      .loadingGraphs {
        position: absolute;
        top: 50%;
        left: calc(50% - 15px);
        z-index: 100;
      }
    `,
  ],
})
export class BlockComponent implements OnInit, OnDestroy {
  network = '';
  block: BlockExtended;
  blockAudit: BlockAudit = undefined;
  blockHeight: number;
  lastBlockHeight: number;
  nextBlockHeight: number;
  blockHash: string;
  isLoadingBlock = true;
  latestBlock: BlockExtended;
  latestBlocks: BlockExtended[] = [];
  transactions: Transaction[];
  isLoadingTransactions = true;
  strippedTransactions: TransactionStripped[];
  overviewTransitionDirection: string;
  isLoadingOverview = true;
  error: any;
  fees: number;
  txsLoadingStatus$: Observable<number>;

  block$: Observable<any>;
  showDetails = false;
  showPreviousBlocklink = true;
  showNextBlocklink = true;
  transactionsError: any = null;
  overviewError: any = null;
  webGlEnabled = true;
  auditParamEnabled: boolean = false;
  auditSupported: boolean;
  auditModeEnabled: boolean;
  auditAvailable = true;
  showAudit: boolean;
  isMobile = window.innerWidth <= 767.98;
  hoverTx: string;
  numMissing: number = 0;
  paginationMaxSize = window.matchMedia('(max-width: 670px)').matches ? 3 : 5;
  page = 1;
  itemsPerPage: number;
  numUnexpected: number = 0;
  mode: 'projected' | 'actual' | 'stale' = 'projected';
  currentQueryParams: Params;

  transactionSubscription: Subscription;
  overviewSubscription: Subscription;
  canonicalSubscription: Subscription;
  keyNavigationSubscription: Subscription;
  blocksSubscription: Subscription;
  cacheBlocksSubscription: Subscription;
  networkChangedSubscription: Subscription;
  queryParamsSubscription: Subscription;
  timeLtrSubscription: Subscription;
  timeLtr: boolean;
  childChangeSubscription: Subscription;
  auditPrefSubscription: Subscription;
  isAuditEnabledSubscription: Subscription;
  oobSubscription: Subscription;
  priceSubscription: Subscription;
  blockConversion: Price;
  canonicalBlock: BlockExtended;
  canonicalTransactions: TransactionStripped[];
  staleTransactions: TransactionStripped[];
  staleStats: ComparisonStats | null = null;
  canonicalStats: ComparisonStats | null = null;
  specialEventLabel: string | null = null;
  specialEventDescription: string | null = null;

  @ViewChildren('blockGraphProjected')
  blockGraphProjected: QueryList<BlockOverviewGraphComponent>;
  @ViewChildren('blockGraphActual')
  blockGraphActual: QueryList<BlockOverviewGraphComponent>;

  constructor(
    private route: ActivatedRoute,
    private location: Location,
    private router: Router,
    private electrsApiService: ElectrsApiService,
    public stateService: StateService,
    private seoService: SeoService,
    private websocketService: WebsocketService,
    private relativeUrlPipe: RelativeUrlPipe,
    private apiService: ApiService,
    private priceService: PriceService,
    private cacheService: CacheService,
    private cd: ChangeDetectorRef,
    private preloadService: PreloadService
  ) {
    this.auditSupported =
      this.stateService.env.AUDIT &&
      this.stateService.env.BASE_MODULE === 'explorer' &&
      this.stateService.env.MINING_DASHBOARD === true;
    this.auditModeEnabled = !this.stateService.hideAudit.value;
    this.webGlEnabled = this.stateService.isBrowser && detectWebGL();
  }

  get showComparison() {
    return this.showAudit || this.block?.stale;
  }

  ngOnInit(): void {
    this.websocketService.want(['blocks', 'mempool-blocks']);
    this.network = this.stateService.network;
    this.itemsPerPage = this.stateService.env.ITEMS_PER_PAGE;

    this.timeLtrSubscription = this.stateService.timeLtr.subscribe((ltr) => {
      this.timeLtr = !!ltr;
    });

    this.setAuditAvailable(this.auditSupported);

    if (this.auditSupported) {
      this.isAuditEnabledSubscription =
        this.isAuditEnabledFromParam().subscribe((auditParam) => {
          if (this.auditParamEnabled) {
            this.auditModeEnabled = auditParam;
          }
        });
    }
    this.auditPrefSubscription = this.stateService.hideAudit.subscribe(
      (hide) => {
        this.auditModeEnabled = !hide;
        this.showAudit =
          this.auditSupported && this.auditAvailable && this.auditModeEnabled;
        if (this.block?.stale) {
          this.setupBlockGraphs();
        }
      }
    );

    this.cacheBlocksSubscription = this.cacheService.loadedBlocks$.subscribe(
      (block) => {
        this.loadedCacheBlock(block);
      }
    );

    this.blocksSubscription = this.stateService.blocks$.subscribe((blocks) => {
      this.latestBlock = blocks[0];
      this.latestBlocks = blocks;
      this.setNextAndPreviousBlockLink();

      for (const block of blocks) {
        if (block.id === this.blockHash) {
          this.block = block;
          if (block.extras) {
            block.extras.minFee = this.getMinBlockFee(block);
            block.extras.maxFee = this.getMaxBlockFee(block);
            if (block?.extras?.reward != undefined) {
              this.fees = block.extras.reward / 100000000;
            }
          }
        } else if (block.height === this.block?.height) {
          this.block.stale = true;
          this.block.canonical = block.id;
          this.fetchCanonicalBlock();
        }
      }
    });

    this.block$ = this.route.paramMap.pipe(
      switchMap((params: ParamMap) => {
        const blockHash: string = params.get('id') || '';
        this.block = undefined;
        this.page = 1;
        this.error = undefined;
        this.fees = undefined;

        if (history.state.data && history.state.data.blockHeight) {
          this.blockHeight = history.state.data.blockHeight;
          this.updateAuditAvailableFromBlockHeight(this.blockHeight);
        }

        let isBlockHeight = false;
        if (/^[0-9]+$/.test(blockHash)) {
          isBlockHeight = true;
          this.stateService.markBlock$.next({
            blockHeight: parseInt(blockHash, 10),
          });
        } else {
          this.blockHash = blockHash;
        }
        document.body.scrollTo(0, 0);

        if (history.state.data && history.state.data.block) {
          this.blockHeight = history.state.data.block.height;
          this.updateAuditAvailableFromBlockHeight(this.blockHeight);
          return of(history.state.data.block);
        } else {
          this.isLoadingTransactions = true;
          this.isLoadingBlock = true;
          this.isLoadingOverview = true;
          this.strippedTransactions = undefined;
          this.blockAudit = undefined;

          let blockInCache: BlockExtended;
          if (isBlockHeight) {
            blockInCache = this.latestBlocks.find(
              (block) => block.height === parseInt(blockHash, 10)
            );
            if (blockInCache) {
              return of(blockInCache);
            }
            return this.electrsApiService
              .getBlockHashFromHeight$(parseInt(blockHash, 10))
              .pipe(
                switchMap((hash) => {
                  this.blockHash = hash;
                  this.location.replaceState(
                    this.router
                      .createUrlTree([
                        (this.network ? '/' + this.network : '') + '/block/',
                        hash,
                      ])
                      .toString()
                  );
                  this.seoService.updateCanonical(this.location.path());
                  return this.apiService.getBlock$(hash).pipe(
                    catchError((err) => {
                      this.error = err;
                      this.isLoadingBlock = false;
                      this.isLoadingOverview = false;
                      this.seoService.logSoft404();
                      return EMPTY;
                    })
                  );
                }),
                catchError((err) => {
                  this.error = err;
                  this.isLoadingBlock = false;
                  this.isLoadingOverview = false;
                  this.seoService.logSoft404();
                  return EMPTY;
                })
              );
          }

          blockInCache = this.latestBlocks.find(
            (block) => block.id === this.blockHash
          );
          if (blockInCache) {
            return of(blockInCache);
          }

          return this.apiService.getBlock$(blockHash).pipe(
            catchError((err) => {
              this.error = err;
              this.isLoadingBlock = false;
              this.isLoadingOverview = false;
              this.seoService.logSoft404();
              return EMPTY;
            })
          );
        }
      }),
      tap((block: BlockExtended) => {
        if (block.previousblockhash) {
          this.preloadService.block$.next(block.previousblockhash);
          if (this.isAuditAvailableFromBlockHeight(block.height)) {
            this.preloadService.blockAudit$.next(block.previousblockhash);
          }
        }
        this.updateAuditAvailableFromBlockHeight(block.height);
        this.block = block;
        if (block.extras) {
          block.extras.minFee = this.getMinBlockFee(block);
          block.extras.maxFee = this.getMaxBlockFee(block);
        }
        this.blockHeight = block.height;
        this.lastBlockHeight = this.blockHeight;
        this.nextBlockHeight = block.height + 1;
        this.specialEventLabel =
          specialBlocks[block.height]?.labelEvent ?? null;
        this.specialEventDescription =
          specialBlocks[block.height]?.labelEventCompleted ?? null;
        this.setNextAndPreviousBlockLink();

        this.seoService.setTitle(
          $localize`:@@block.component.browser-title:Block ${block.height}:BLOCK_HEIGHT:: ${block.id}:BLOCK_ID:`
        );

        this.seoService.setDescription(
          $localize`:@@meta.description.bitcoin.block:See size, weight, fee range, included transactions, audit (expected v actual), and more for Bitcoin${seoDescriptionNetwork(
            this.stateService.network
          )} block ${block.height}:BLOCK_HEIGHT: (${block.id}:BLOCK_ID:).`
        );
        this.isLoadingBlock = false;
        if (block?.extras?.reward !== undefined) {
          this.fees = block.extras.reward / 100000000;
        }
        this.isLoadingOverview = true;
        this.overviewError = null;

        if (!block.stale) {
          this.stateService.markBlock$.next({ blockHeight: this.blockHeight });
          const cachedBlock = this.cacheService.getCachedBlock(block.height);
          if (!cachedBlock) {
            this.cacheService.loadBlock(block.height);
          } else {
            this.loadedCacheBlock(cachedBlock);
          }
        }
      }),
      throttleTime(300, asyncScheduler, { leading: true, trailing: true }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.transactionSubscription = this.block$
      .pipe(
        switchMap((block) =>
          this.electrsApiService.getBlockTransactions$(block.id).pipe(
            catchError((err) => {
              this.transactionsError = err;
              return of([]);
            })
          )
        )
      )
      .subscribe(
        (transactions: Transaction[]) => {
          if (this.fees === undefined && transactions[0]) {
            this.fees =
              transactions[0].vout.reduce(
                (acc: number, curr: Vout) => acc + curr.value,
                0
              ) / 100000000;
          }
          this.transactions = transactions;
          this.isLoadingTransactions = false;
        },
        (error) => {
          this.error = error;
          this.isLoadingBlock = false;
          this.isLoadingOverview = false;
        }
      );

    this.overviewSubscription = this.block$
      .pipe(
        switchMap((block) => {
          return forkJoin([
            of(block),
            this.apiService.getStrippedBlockTransactions$(block.id).pipe(
              catchError((err) => {
                this.overviewError = err;
                return of(null);
              })
            ),
            !this.isAuditAvailableFromBlockHeight(block.height)
              ? of(null)
              : this.apiService.getBlockAudit$(block.id).pipe(
                  catchError((err) => {
                    this.overviewError = err;
                    return of(null);
                  })
                ),
            block.stale
              ? this.electrsApiService
                  .getBlockHashFromHeight$(block.height)
                  .pipe(
                    switchMap((hash) => {
                      return forkJoin([
                        this.apiService.getBlock$(hash).pipe(
                          catchError((err) => {
                            console.error(
                              'Error fetching canonical block:',
                              err
                            );
                            this.overviewError = err;
                            return of(null);
                          })
                        ),
                        this.apiService
                          .getStrippedBlockTransactions$(hash)
                          .pipe(
                            catchError((err) => {
                              console.error(
                                'Error fetching canonical transactions:',
                                err
                              );
                              this.overviewError = err;
                              return of(null);
                            })
                          ),
                      ]);
                    }),
                    catchError((err) => {
                      console.error('Error fetching canonical block:', err);
                      return of([null, null]);
                    })
                  )
              : of([null, null]),
          ]);
        })
      )
      .subscribe(
        ([
          block,
          transactions,
          blockAudit,
          [canonicalBlock, canonicalTransactions],
        ]) => {
          if (transactions) {
            this.strippedTransactions = transactions;
          } else {
            this.strippedTransactions = [];
          }
          this.blockAudit = blockAudit;

          // Handle canonical block data from the overviewSubscription (when block.stale is true from backend)
          if (block.stale && canonicalBlock && canonicalTransactions) {
            this.canonicalBlock = canonicalBlock;
            this.canonicalTransactions = canonicalTransactions;
            this.staleTransactions = JSON.parse(JSON.stringify(transactions));
            this.setupStaleComparison();
            this.setAuditMode(false);
          } else if (!block.stale) {
            // Clear stale-related data when viewing a non-stale block
            this.staleTransactions = null;
            this.canonicalBlock = null;
            this.canonicalTransactions = null;
          }

          this.setupBlockAudit();
          this.isLoadingOverview = false;
        }
      );

    // Should we call setupBlockAudit() here?
    // this.setupBlockAudit();

    this.networkChangedSubscription =
      this.stateService.networkChanged$.subscribe(
        (network) => (this.network = network)
      );

    this.queryParamsSubscription = this.route.queryParams.subscribe(
      (params) => {
        this.currentQueryParams = params;
        if (params['showDetails'] === 'true') {
          this.showDetails = true;
        } else {
          this.showDetails = false;
        }
        switch (params['view']) {
          case 'stale':
            this.mode = 'stale';
            break;
          case 'projected':
            this.mode = 'projected';
            break;
          default:
            this.mode = 'actual';
            break;
        }
        this.setupBlockGraphs();
      }
    );

    // Handle fragment scrolling with header offset
    this.route.fragment.subscribe((fragment) => {
      if (fragment) {
        setTimeout(() => {
          const element = document.getElementById(fragment);
          if (element) {
            const headerOffset = 70;
            const elementPosition = element.getBoundingClientRect().top;
            const offsetPosition =
              elementPosition + window.pageYOffset - headerOffset;
            window.scrollTo({
              top: offsetPosition,
              behavior: 'smooth',
            });
          }
        }, 100); // Small delay to ensure DOM is updated
      }
    });

    this.keyNavigationSubscription = this.stateService.keyNavigation$.subscribe(
      (event) => {
        const prevKey = this.timeLtr ? 'ArrowLeft' : 'ArrowRight';
        const nextKey = this.timeLtr ? 'ArrowRight' : 'ArrowLeft';
        if (
          this.showPreviousBlocklink &&
          event.key === prevKey &&
          this.nextBlockHeight - 2 >= 0
        ) {
          this.navigateToPreviousBlock();
        }
        if (event.key === nextKey) {
          if (this.showNextBlocklink) {
            this.navigateToNextBlock();
          } else {
            this.router.navigate([
              this.relativeUrlPipe.transform('/mempool-block'),
              '0',
            ]);
          }
        }
      }
    );

    if (this.priceSubscription) {
      this.priceSubscription.unsubscribe();
    }
    this.priceSubscription = combineLatest([
      this.stateService.fiatCurrency$,
      this.block$,
    ])
      .pipe(
        switchMap(([currency, block]) => {
          return this.priceService
            .getBlockPrice$(block.timestamp, true, currency)
            .pipe(
              tap((price) => {
                this.blockConversion = price;
              })
            );
        })
      )
      .subscribe();

    this.txsLoadingStatus$ = this.route.paramMap.pipe(
      switchMap(() => this.stateService.loadingIndicators$),
      map((indicators) =>
        indicators['blocktxs-' + this.blockHash] !== undefined
          ? indicators['blocktxs-' + this.blockHash]
          : 0
      )
    );
  }

  ngAfterViewInit(): void {
    this.childChangeSubscription = combineLatest([
      this.blockGraphProjected.changes.pipe(startWith(null)),
      this.blockGraphActual.changes.pipe(startWith(null)),
    ]).subscribe(() => {
      this.setupBlockGraphs();
    });
  }

  ngOnDestroy(): void {
    this.stateService.markBlock$.next({});
    this.transactionSubscription?.unsubscribe();
    this.overviewSubscription?.unsubscribe();
    this.canonicalSubscription?.unsubscribe();
    this.keyNavigationSubscription?.unsubscribe();
    this.blocksSubscription?.unsubscribe();
    this.cacheBlocksSubscription?.unsubscribe();
    this.networkChangedSubscription?.unsubscribe();
    this.queryParamsSubscription?.unsubscribe();
    this.timeLtrSubscription?.unsubscribe();
    this.childChangeSubscription?.unsubscribe();
    this.auditPrefSubscription?.unsubscribe();
    this.isAuditEnabledSubscription?.unsubscribe();
    this.oobSubscription?.unsubscribe();
    this.priceSubscription?.unsubscribe();
    this.blockGraphProjected.forEach((graph) => {
      graph.destroy();
    });
    this.blockGraphActual.forEach((graph) => {
      graph.destroy();
    });
  }

  toggleShowDetails(): void {
    if (this.showDetails) {
      this.showDetails = false;
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { showDetails: false, view: this.mode },
        queryParamsHandling: 'merge',
        fragment: 'block',
      });
    } else {
      this.showDetails = true;
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { showDetails: true, view: this.mode },
        queryParamsHandling: 'merge',
        fragment: 'details',
      });
    }
  }

  navigateToPreviousBlock(): void {
    if (!this.block) {
      return;
    }
    const block = this.latestBlocks.find(
      (b) => b.height === this.nextBlockHeight - 2
    );
    this.router.navigate(
      [
        this.relativeUrlPipe.transform('/block/'),
        block ? block.id : this.block.previousblockhash,
      ],
      { state: { data: { block, blockHeight: this.nextBlockHeight - 2 } } }
    );
  }

  navigateToNextBlock(): void {
    const block = this.latestBlocks.find(
      (b) => b.height === this.nextBlockHeight
    );
    this.router.navigate(
      [
        this.relativeUrlPipe.transform('/block/'),
        block ? block.id : this.nextBlockHeight,
      ],
      { state: { data: { block, blockHeight: this.nextBlockHeight } } }
    );
  }

  setNextAndPreviousBlockLink(): void {
    if (this.latestBlock) {
      if (!this.blockHeight) {
        this.showPreviousBlocklink = false;
      } else {
        this.showPreviousBlocklink = true;
      }
      if (
        this.latestBlock.height != null &&
        this.latestBlock.height === this.blockHeight
      ) {
        this.showNextBlocklink = false;
      } else {
        this.showNextBlocklink = true;
      }
    }
  }

  fetchCanonicalBlock(): void {
    if (!this.block?.stale || !this.block?.height) {
      return;
    }

    this.electrsApiService
      .getBlockHashFromHeight$(this.block.height)
      .pipe(
        switchMap((hash) => {
          return forkJoin([
            this.apiService.getBlock$(hash).pipe(
              catchError((err) => {
                console.error('Error fetching canonical block:', err);
                this.overviewError = err;
                return of(null);
              })
            ),
            this.apiService.getStrippedBlockTransactions$(hash).pipe(
              catchError((err) => {
                console.error('Error fetching canonical transactions:', err);
                this.overviewError = err;
                return of(null);
              })
            ),
          ]);
        }),
        catchError((err) => {
          console.error('Error fetching canonical block hash:', err);
          return of([null, null]);
        })
      )
      .subscribe(([canonicalBlock, canonicalTransactions]) => {
        this.canonicalBlock = canonicalBlock;
        this.canonicalTransactions = canonicalTransactions;

        if (
          canonicalBlock &&
          canonicalTransactions &&
          this.strippedTransactions
        ) {
          this.staleTransactions = JSON.parse(
            JSON.stringify(this.strippedTransactions)
          );
          this.setupStaleComparison();
          this.setAuditMode(false);
          this.setupBlockGraphs();
        }
      });
  }

  setupStaleComparison(): void {
    this.staleStats = {
      totalFees: 0,
      totalSize: 0,
      txCount: 0,
      feeDelta: 0,
      sizeDelta: 0,
      txDelta: 0,
    };
    this.canonicalStats = {
      totalFees: 0,
      totalSize: 0,
      txCount: 0,
      feeDelta: 0,
      sizeDelta: 0,
      txDelta: 0,
    };
    const staleTransactions = this.staleTransactions || [];
    const canonicalTransactions = this.canonicalTransactions || [];

    const inStale = {};
    const inCanonical = {};

    for (const tx of staleTransactions) {
      inStale[tx.txid] = tx;
      this.staleStats.totalFees += tx.fee;
      this.staleStats.totalSize += tx.size;
      this.staleStats.txCount++;
    }
    for (const tx of canonicalTransactions) {
      inCanonical[tx.txid] = tx;
      this.canonicalStats.totalFees += tx.fee;
      this.canonicalStats.totalSize += tx.size;
      this.canonicalStats.txCount++;
    }

    for (const tx of staleTransactions) {
      tx.context = 'stale';
      if (inCanonical[tx.txid]) {
        tx.status = 'matched';
        // opportunistically fix missing timestamps
        if (
          inCanonical[tx.txid].time &&
          (!tx.time || tx.time > inCanonical[tx.txid].time)
        ) {
          tx.time = inCanonical[tx.txid].time;
        }
      } else {
        tx.status = 'unmatched';
      }
    }

    for (const tx of canonicalTransactions) {
      tx.context = 'canonical';
      if (inStale[tx.txid]) {
        tx.status = 'matched';
        // opportunistically fix missing timestamps
        if (
          inStale[tx.txid].time &&
          (!tx.time || tx.time > inStale[tx.txid].time)
        ) {
          tx.time = inStale[tx.txid].time;
        }
      } else {
        tx.status = 'unmatched';
      }
    }

    // if vsize was rounded, the total weight we calculated isn't exact and can exceed the 4MB limit
    this.staleStats.totalSize = Math.min(this.staleStats.totalSize, 4_000_000);
    this.canonicalStats.totalSize = Math.min(
      this.canonicalStats.totalSize,
      4_000_000
    );

    this.staleStats.feeDelta =
      this.canonicalStats.totalFees > 0
        ? (this.staleStats.totalFees - this.canonicalStats.totalFees) /
          this.canonicalStats.totalFees
        : this.canonicalStats.totalFees > 0
          ? Infinity
          : -Infinity;
    this.staleStats.sizeDelta =
      this.canonicalStats.totalSize > 0
        ? (this.staleStats.totalSize - this.canonicalStats.totalSize) /
          this.canonicalStats.totalSize
        : this.canonicalStats.totalSize > 0
          ? Infinity
          : -Infinity;
    this.staleStats.txDelta =
      this.canonicalStats.txCount > 0
        ? (this.staleStats.txCount - this.canonicalStats.txCount) /
          this.canonicalStats.txCount
        : this.canonicalStats.txCount > 0
          ? Infinity
          : -Infinity;

    this.canonicalStats.feeDelta =
      this.staleStats.totalFees > 0
        ? (this.canonicalStats.totalFees - this.staleStats.totalFees) /
          this.staleStats.totalFees
        : this.staleStats.totalFees > 0
          ? Infinity
          : -Infinity;
    this.canonicalStats.sizeDelta =
      this.staleStats.totalSize > 0
        ? (this.canonicalStats.totalSize - this.staleStats.totalSize) /
          this.staleStats.totalSize
        : this.staleStats.totalSize > 0
          ? Infinity
          : -Infinity;
    this.canonicalStats.txDelta =
      this.staleStats.txCount > 0
        ? (this.canonicalStats.txCount - this.staleStats.txCount) /
          this.staleStats.txCount
        : this.staleStats.txCount > 0
          ? Infinity
          : -Infinity;
  }

  setupBlockAudit(): void {
    const transactions = this.strippedTransactions || [];
    const blockAudit = this.blockAudit;
    if (transactions && blockAudit) {
      const inTemplate = {};
      const inBlock = {};
      const isUnseen = {};
      const isAdded = {};
      const isCensored = {};
      const isMissing = {};
      const isSelected = {};
      const isFresh = {};
      const isSigop = {};
      this.numMissing = 0;
      this.numUnexpected = 0;

      if (blockAudit?.template) {
        // BCH has no priotized transactions
        for (const tx of blockAudit.template) {
          inTemplate[tx.txid] = true;
        }
        for (const tx of transactions) {
          inBlock[tx.txid] = true;
        }
        for (const txid of blockAudit.unseenTxs || []) {
          isUnseen[txid] = true;
        }
        for (const txid of blockAudit.addedTxs) {
          isAdded[txid] = true;
        }
        for (const txid of blockAudit.missingTxs) {
          isCensored[txid] = true;
        }
        for (const txid of blockAudit.freshTxs || []) {
          isFresh[txid] = true;
        }
        for (const txid of blockAudit.sigopTxs || []) {
          isSigop[txid] = true;
        }
        // set transaction statuses
        for (const tx of blockAudit.template) {
          tx.context = 'projected';
          if (isCensored[tx.txid] && tx.rate >= 1) {
            tx.status = 'censored';
          } else if (inBlock[tx.txid]) {
            tx.status = 'found';
          } else {
            if (isFresh[tx.txid]) {
              tx.status = 'fresh';
            } else if (isSigop[tx.txid]) {
              tx.status = 'sigop';
            } else {
              tx.status = 'missing';
            }
            isMissing[tx.txid] = true;
            this.numMissing++;
          }
        }
        let anySeen = false;
        for (let index = transactions.length - 1; index >= 0; index--) {
          const tx = transactions[index];
          tx.context = 'actual';
          if (index === 0) {
            tx.status = null;
          } else if (
            isAdded[tx.txid] &&
            (blockAudit.version === 0 || isUnseen[tx.txid])
          ) {
            tx.status = 'added';
          } else if (inTemplate[tx.txid]) {
            anySeen = true;
            tx.status = 'found';
          } else if (isUnseen[tx.txid] && anySeen) {
            tx.status = 'added';
          } else {
            tx.status = 'selected';
            isSelected[tx.txid] = true;
            this.numUnexpected++;
          }
        }
        for (const tx of transactions) {
          inBlock[tx.txid] = true;
        }

        blockAudit.feeDelta =
          blockAudit.expectedFees > 0
            ? (blockAudit.expectedFees - this.block?.extras.totalFees) /
              blockAudit.expectedFees
            : 0;
        blockAudit.sizeDelta =
          blockAudit.expectedSize > 0
            ? (blockAudit.expectedSize - this.block?.size) /
              blockAudit.expectedSize
            : 0;
        blockAudit.txDelta =
          blockAudit.template.length > 0
            ? (blockAudit.template.length - this.block?.tx_count) /
              blockAudit.template.length
            : 0;
        this.blockAudit = blockAudit;
        this.setAuditAvailable(true);
      } else {
        this.setAuditAvailable(false);
      }
    } else {
      this.setAuditAvailable(false);
    }

    this.setupBlockGraphs();
    this.cd.markForCheck();
  }

  setupBlockGraphs(): void {
    if (
      this.block?.stale &&
      !this.showAudit &&
      this.staleTransactions &&
      this.canonicalTransactions
    ) {
      this.blockGraphProjected.forEach((graph) => {
        graph.destroy();
        if (this.isMobile && this.mode === 'actual') {
          graph.setup(this.canonicalTransactions || []);
        } else {
          graph.setup(this.staleTransactions || []);
        }
      });
      this.blockGraphActual.forEach((graph) => {
        graph.destroy();
        graph.setup(this.canonicalTransactions || []);
      });
    } else if (this.blockAudit || this.strippedTransactions) {
      this.blockGraphProjected.forEach((graph) => {
        graph.destroy();
        if (this.isMobile && this.mode === 'actual') {
          graph.setup(
            this.blockAudit?.transactions || this.strippedTransactions || []
          );
        } else {
          graph.setup(this.blockAudit?.template || []);
        }
      });
      this.blockGraphActual.forEach((graph) => {
        graph.destroy();
        graph.setup(
          this.blockAudit?.transactions || this.strippedTransactions || []
        );
      });
    }
  }

  onResize(event: Event): void {
    const target = event.target as Window;
    const isMobile = target.innerWidth <= 767.98;
    const changed = isMobile !== this.isMobile;
    this.isMobile = isMobile;
    this.paginationMaxSize = target.innerWidth < 670 ? 3 : 5;

    if (changed) {
      this.changeMode(this.mode);
    }
  }

  changeMode(mode: 'projected' | 'actual' | 'stale'): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { showDetails: this.showDetails, view: mode },
      queryParamsHandling: 'merge',
      fragment: 'overview',
    });
  }

  onTxClick(event: { tx: TransactionStripped; keyModifier: boolean }): void {
    const url = new RelativeUrlPipe(this.stateService).transform(
      `/tx/${event.tx.txid}`
    );
    if (!event.keyModifier) {
      this.router.navigate([url]);
    } else {
      window.open(url, '_blank');
    }
  }

  onTxHover(txid: string): void {
    if (txid && txid.length) {
      this.hoverTx = txid;
    } else {
      this.hoverTx = null;
    }
  }

  pageChange(page: number, target: HTMLElement, delay: number = 0) {
    const start = (page - 1) * this.itemsPerPage;
    this.isLoadingTransactions = true;
    this.transactions = null;
    this.transactionsError = null;

    // Scroll to target with header offset
    this.scrollToTopTarget(target);

    this.electrsApiService
      .getBlockTransactions$(this.block.id, start)
      .pipe(
        catchError((err) => {
          this.transactionsError = err;
          return of([]);
        })
      )
      .subscribe((transactions) => {
        this.transactions = transactions;
        this.isLoadingTransactions = false;

        if (delay) {
          // Scroll to target with delay
          setTimeout(() => {
            this.scrollToTopTarget(target);
          }, delay);
        } else {
          this.scrollToTopTarget(target);
        }
      });
  }

  scrollToTopTarget(target: HTMLElement): void {
    const headerOffset = 70;
    const elementPosition = target.getBoundingClientRect().top;
    // With a small offset to account for the site header
    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth',
    });
  }

  setAuditAvailable(available: boolean): void {
    this.auditAvailable = available;
    this.showAudit =
      this.auditAvailable && this.auditModeEnabled && this.auditSupported;
  }

  toggleAuditMode(): void {
    this.stateService.hideAudit.next(this.auditModeEnabled);

    const queryParams = { ...this.currentQueryParams };
    delete queryParams['audit'];

    let newUrl = this.router.url.split('?')[0];
    const queryString = new URLSearchParams(queryParams).toString();
    if (queryString) {
      newUrl += '?' + queryString;
    }
    this.location.replaceState(newUrl);
  }

  setAuditMode(mode: boolean): void {
    this.auditModeEnabled = mode;
    this.showAudit = this.auditAvailable && this.auditModeEnabled;
    if (this.block?.stale) {
      this.setupBlockGraphs();
    }
  }

  updateAuditAvailableFromBlockHeight(blockHeight: number): void {
    if (!this.isAuditAvailableFromBlockHeight(blockHeight)) {
      this.setAuditAvailable(false);
    }
  }

  isAuditEnabledFromParam(): Observable<boolean> {
    return this.route.queryParams.pipe(
      map((params) => {
        this.auditParamEnabled = 'audit' in params;

        return this.auditParamEnabled ? !(params['audit'] === 'false') : true;
      })
    );
  }

  isAuditAvailableFromBlockHeight(blockHeight: number): boolean {
    if (!this.auditSupported) {
      return false;
    }
    switch (this.stateService.network) {
      case 'testnet4':
        if (
          blockHeight < this.stateService.env.TESTNET4_BLOCK_AUDIT_START_HEIGHT
        ) {
          return false;
        }
        break;
      case 'scalenet':
        if (
          blockHeight < this.stateService.env.SCALENET_BLOCK_AUDIT_START_HEIGHT
        ) {
          return false;
        }
        break;
      case 'chipnet':
        if (
          blockHeight < this.stateService.env.CHIPNET_BLOCK_AUDIT_START_HEIGHT
        ) {
          return false;
        }
        break;
      default:
        if (
          blockHeight < this.stateService.env.MAINNET_BLOCK_AUDIT_START_HEIGHT
        ) {
          return false;
        }
    }
    return true;
  }

  getMinBlockFee(block: BlockExtended): number {
    if (block?.extras?.feeRange) {
      // heuristic to check if feeRange is adjusted for effective rates
      if (block.extras.medianFee === block.extras.feeRange[3]) {
        return block.extras.feeRange[1];
      } else {
        return block.extras.feeRange[0];
      }
    }
    return 0;
  }

  getMaxBlockFee(block: BlockExtended): number {
    if (block?.extras?.feeRange) {
      return block.extras.feeRange[block.extras.feeRange.length - 1];
    }
    return 0;
  }

  loadedCacheBlock(block: BlockExtended): void {
    if (
      this.block &&
      block.height === this.block.height &&
      block.id !== this.block.id
    ) {
      this.block.stale = true;
      this.block.canonical = block.id;
      this.fetchCanonicalBlock();
    }
  }
}
