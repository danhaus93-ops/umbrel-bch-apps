import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  HostListener,
  ViewChild,
  ElementRef,
  Inject,
  ChangeDetectorRef,
} from '@angular/core';
import { ElectrsApiService } from '@app/services/backend-api.service';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import {
  switchMap,
  filter,
  catchError,
  tap,
  map,
  retry,
  startWith,
  repeat,
  take,
} from 'rxjs/operators';
import { Transaction } from '@app/interfaces/backend-api.interface';
import {
  of,
  merge,
  Subscription,
  Observable,
  Subject,
  combineLatest,
  BehaviorSubject,
} from 'rxjs';
import { StateService } from '@app/services/state.service';
import { CacheService } from '@app/services/cache.service';
import { WebsocketService } from '@app/services/websocket.service';
import { AudioService } from '@app/services/audio.service';
import { ApiService } from '@app/services/api.service';
import { SeoService } from '@app/services/seo.service';
import { StorageService } from '@app/services/storage.service';
import { seoDescriptionNetwork } from '@app/shared/common.utils';
import { getTransactionFlags } from '@app/shared/transaction.utils';
import { Filter, toFilters } from '@app/shared/filters.utils';
import {
  BlockExtended,
  MempoolPosition,
  DifficultyAdjustment,
} from '@interfaces/node-api.interface';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { PriceService } from '@app/services/price.service';
import { EnterpriseService } from '@app/services/enterprise.service';
import { ZONE_SERVICE } from '@app/injection-tokens';
import { MiningService, MiningStats } from '@app/services/mining.service';
import { ETA, EtaService } from '@app/services/eta.service';

export interface Pool {
  id: number;
  name: string;
  slug: string;
  minerNames: string[] | null;
}

export interface TxAuditStatus {
  seen?: boolean;
  expected?: boolean;
  added?: boolean;
  delayed?: number;
  conflict?: boolean;
  coinbase?: boolean;
  firstSeen?: number;
}

// Known duplicate transaction IDs from early Bitcoin history (pre-BIP-30)
const DUPLICATE_TX_BLOCKS: Record<string, [number, number]> = {
  e3bf3d07d4b0375638d5f1db5255fe07ba2c4cb067cd81b84ee974b6585fb468: [
    91722, 91880,
  ],
  d5d27987d2a3dfc724e359870c6644b40e497bdc0589a033220fe15429d88599: [
    91812, 91842,
  ],
};

@Component({
  selector: 'app-transaction',
  templateUrl: './transaction.component.html',
  styleUrls: ['./transaction.component.scss'],
  standalone: false,
})
export class TransactionComponent implements OnInit, AfterViewInit, OnDestroy {
  network = '';
  tx: Transaction;
  txId: string;
  txInBlockIndex: number;
  mempoolPosition: MempoolPosition;
  gotInitialPosition = false;
  isLoadingTx = true;
  error: any = undefined;
  errorUnblinded: any = undefined;
  loadingCachedTx = false;
  waitingForTransaction = false;
  latestBlock: BlockExtended;
  transactionTime = -1;
  subscription: Subscription;
  transactionTimesSubscription: Subscription;
  // fetchCachedTxSubscription: Subscription;
  mempoolPositionSubscription: Subscription;
  queryParamsSubscription: Subscription;
  urlFragmentSubscription: Subscription;
  mempoolBlocksSubscription: Subscription;
  blocksSubscription: Subscription;
  miningSubscription: Subscription;
  auditSubscription: Subscription;
  txConfirmedSubscription: Subscription;
  currencyChangeSubscription: Subscription;
  fragmentParams: URLSearchParams;
  sigops: number | null;
  adjustedSize: number | null;
  pool: Pool | null;
  auditStatus: TxAuditStatus | null;
  filters: Filter[] = [];
  miningStats: MiningStats;
  transactionTimes$ = new Subject<string>();
  // fetchCachedTx$ = new Subject<string>();
  fetchMiningInfo$ = new Subject<{
    hash: string;
    height: number;
    txid: string;
  }>();
  txChanged$ = new BehaviorSubject<boolean>(false); // triggered whenever this.tx changes (long term, we should refactor to make this.tx an observable itself)
  ETA$: Observable<ETA | null>;
  isCached: boolean = false;
  now = Date.now();
  da$: Observable<DifficultyAdjustment>;
  inputIndex: number;
  outputIndex: number;
  graphExpanded: boolean = false;
  graphWidth: number = 1068;
  graphHeight: number = 360;
  inOutLimit: number = 150;
  maxInOut: number = 0;
  flowPrefSubscription: Subscription;
  hideFlow: boolean;
  overrideFlowPreference: boolean = null;
  flowEnabled: boolean;
  tooltipPosition: { x: number; y: number };
  isMobile: boolean;
  firstLoad = true;
  isLoadingFirstSeen = false;
  duplicateTxBlocks: [number, number] | undefined;
  hasEffectiveFeeRate: boolean;
  accelerateCtaType: 'alert' | 'button' = 'button';
  auditEnabled: boolean;

  graphContainer: ElementRef;
  @ViewChild('graphContainer')
  set flowAnchor(element: ElementRef | null | undefined) {
    if (element) {
      this.graphContainer = element;
      setTimeout(() => {
        this.applyFragment();
      }, 0);
    }
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private relativeUrlPipe: RelativeUrlPipe,
    private electrsApiService: ElectrsApiService,
    public stateService: StateService,
    private cacheService: CacheService,
    private websocketService: WebsocketService,
    private audioService: AudioService,
    private apiService: ApiService,
    private seoService: SeoService,
    private priceService: PriceService,
    private storageService: StorageService,
    private enterpriseService: EnterpriseService,
    private miningService: MiningService,
    private etaService: EtaService,
    private cd: ChangeDetectorRef,
    @Inject(ZONE_SERVICE) private zoneService: any
  ) {}

  ngOnInit() {
    this.hideFlow = this.stateService.hideFlow.value;
    this.auditEnabled =
      this.stateService.env.AUDIT &&
      this.stateService.env.BASE_MODULE === 'explorer' &&
      this.stateService.env.MINING_DASHBOARD === true;

    this.enterpriseService.page();

    this.miningService.getMiningStats('1m').subscribe((stats) => {
      this.miningStats = stats;
    });

    this.websocketService.want(['blocks', 'mempool-blocks']);
    this.stateService.networkChanged$.subscribe((network) => {
      this.network = network;
    });

    this.accelerateCtaType =
      (this.storageService.getValue('accel-cta-type') as 'alert' | 'button') ??
      'button';

    this.setFlowEnabled();
    this.flowPrefSubscription = this.stateService.hideFlow.subscribe((hide) => {
      this.hideFlow = !!hide;
      this.setFlowEnabled();
    });

    this.da$ = this.stateService.difficultyAdjustment$.pipe(
      tap(() => {
        this.now = Date.now();
      })
    );

    this.urlFragmentSubscription = this.route.fragment.subscribe((fragment) => {
      this.updateFragmentParams(fragment);
    });

    this.blocksSubscription = this.stateService.blocks$.subscribe((blocks) => {
      this.latestBlock = blocks[0];
    });

    this.transactionTimesSubscription = this.transactionTimes$
      .pipe(
        tap(() => {
          this.isLoadingFirstSeen = true;
        }),
        switchMap((txid) =>
          this.apiService.getTransactionTimes$([txid]).pipe(
            retry({ count: 2, delay: 2000 }),
            // Try again until we either get a valid response, or the transaction is confirmed
            repeat({ delay: 2000 }),
            filter(
              (transactionTimes) =>
                transactionTimes?.[0] > 0 || this.tx.status?.confirmed
            ),
            take(1)
          )
        )
      )
      .subscribe((transactionTimes) => {
        this.isLoadingFirstSeen = false;
        if (transactionTimes?.length && transactionTimes[0]) {
          this.transactionTime = transactionTimes[0];
        }
      });

    // this.fetchCachedTxSubscription = this.fetchCachedTx$
    //   .pipe(
    //     tap(() => {
    //       this.loadingCachedTx = true;
    //     }),
    //     switchMap((txId) => this.apiService.getRbfCachedTx$(txId)),
    //     catchError(() => {
    //       return of(null);
    //     })
    //   )
    //   .subscribe((tx) => {
    //     this.loadingCachedTx = false;
    //     if (!tx) {
    //       this.seoService.logSoft404();
    //       return;
    //     }
    //     this.seoService.clearSoft404();

    //     if (!this.tx) {
    //       this.tx = tx;
    //       this.setFeatures();
    //       this.isCached = true;
    //       if (tx.fee === undefined) {
    //         this.tx.fee = 0;
    //       }
    //       this.tx.feePerSize = tx.fee / tx.size;
    //       this.isLoadingTx = false;
    //       this.error = undefined;
    //       this.waitingForTransaction = false;
    //       this.graphExpanded = false;
    //       this.transactionTime = tx.firstSeen || 0;
    //       this.setupGraph();
    //       this.txChanged$.next(true);
    //     }
    //   });

    this.miningSubscription = this.fetchMiningInfo$
      .pipe(
        filter((target) => target.txid === this.txId && !this.pool),
        tap(() => {
          this.pool = null;
        }),
        switchMap(({ hash, height }) => {
          const foundBlock = this.cacheService.getCachedBlock(height) || null;
          return foundBlock
            ? of(foundBlock.extras.pool)
            : this.apiService.getBlock$(hash).pipe(
                map((block) => block.extras.pool),
                retry({ count: 3, delay: 2000 }),
                catchError(() => of(null))
              );
        }),
        catchError((e) => {
          return of(null);
        })
      )
      .subscribe((pool) => {
        this.pool = pool;
      });

    this.auditSubscription = this.fetchMiningInfo$
      .pipe(
        filter((target) => target.txid === this.txId),
        tap(() => {
          this.auditStatus = null;
        }),
        switchMap(({ hash, height, txid }) => {
          const auditAvailable = this.isAuditAvailable(height);
          const isCoinbase = this.tx.vin.some((v) => v.is_coinbase);
          const fetchAudit = auditAvailable && !isCoinbase;

          const addFirstSeen = (
            audit: TxAuditStatus | null,
            hash: string,
            height: number,
            txid: string,
            useFullSummary: boolean
          ) => {
            if (
              this.isFirstSeenAvailable(height) &&
              !audit?.firstSeen && // firstSeen is not already in audit
              (!audit || audit?.seen) // audit is disabled or tx is already seen (meaning 'firstSeen' is in block summary)
            ) {
              return useFullSummary
                ? this.apiService.getStrippedBlockTransactions$(hash).pipe(
                    map((strippedTxs) => {
                      return {
                        audit,
                        firstSeen: strippedTxs.find((tx) => tx.txid === txid)
                          ?.time,
                      };
                    }),
                    catchError(() => of({ audit }))
                  )
                : this.apiService.getStrippedBlockTransaction$(hash, txid).pipe(
                    map((strippedTx) => {
                      return { audit, firstSeen: strippedTx?.time };
                    }),
                    catchError(() => of({ audit }))
                  );
            }
            return of({ audit });
          };

          if (fetchAudit) {
            // If block audit is already cached, use it to get transaction audit
            const blockAuditLoaded = this.apiService.getBlockAuditLoaded(hash);
            if (blockAuditLoaded) {
              return this.apiService.getBlockAudit$(hash).pipe(
                map((audit) => {
                  const isAdded = audit.addedTxs.includes(txid);
                  const isExpected = audit.template.some(
                    (tx) => tx.txid === txid
                  );
                  const firstSeen = audit.template.find(
                    (tx) => tx.txid === txid
                  )?.time;
                  const wasSeen =
                    audit.version === 1
                      ? !audit.unseenTxs.includes(txid)
                      : isExpected;
                  return {
                    seen: wasSeen,
                    expected: isExpected,
                    added: isAdded && (audit.version === 0 || !wasSeen),
                    firstSeen,
                  };
                }),
                switchMap((audit) =>
                  addFirstSeen(audit, hash, height, txid, true)
                ),
                catchError(() => {
                  return of({ audit: null });
                })
              );
            } else {
              return this.apiService.getBlockTxAudit$(hash, txid).pipe(
                retry({ count: 3, delay: 2000 }),
                switchMap((audit) =>
                  addFirstSeen(audit, hash, height, txid, false)
                ),
                catchError(() => {
                  return of({ audit: null });
                })
              );
            }
          } else {
            const audit = isCoinbase ? { coinbase: true } : null;
            return addFirstSeen(
              audit,
              hash,
              height,
              txid,
              this.apiService.getBlockSummaryLoaded(hash)
            );
          }
        })
      )
      .subscribe((auditStatus) => {
        this.auditStatus = auditStatus?.audit;
        const firstSeen =
          this.auditStatus?.firstSeen || auditStatus['firstSeen'];
        if (firstSeen) {
          this.transactionTime = firstSeen;
        }
      });

    this.mempoolPositionSubscription =
      this.stateService.mempoolTxPosition$.subscribe((txPosition) => {
        this.now = Date.now();
        if (
          txPosition &&
          txPosition.txid === this.txId &&
          txPosition.position
        ) {
          this.mempoolPosition = txPosition.position;
          if (this.tx && !this.tx.status.confirmed) {
            const txFeePerSize = this.tx.feePerSize;
            this.stateService.markBlock$.next({
              txid: txPosition.txid,
              txFeePerSize: txFeePerSize,
              mempoolPosition: this.mempoolPosition,
            });
            this.txInBlockIndex = this.mempoolPosition.block;

            if (this.stateService.network === '') {
              this.miningService.getMiningStats('1m').subscribe((stats) => {
                this.miningStats = stats;
              });
            }
          }
          this.gotInitialPosition = true;
        } else {
          this.mempoolPosition = null;
        }
      });

    this.subscription = this.zoneService
      .wrapObservable(
        this.route.paramMap.pipe(
          switchMap((params: ParamMap) => {
            const urlMatch = (params.get('id') || '').split(':');
            if (urlMatch.length === 2 && urlMatch[1].length === 64) {
              const vin = parseInt(urlMatch[0], 10);
              this.txId = urlMatch[1];
              // rewrite legacy vin syntax
              if (!isNaN(vin)) {
                this.fragmentParams.set('vin', vin.toString());
                this.fragmentParams.delete('vout');
              }
              this.router.navigate(
                [this.relativeUrlPipe.transform('/tx'), this.txId],
                {
                  queryParamsHandling: 'merge',
                  fragment: this.fragmentParams.toString(),
                }
              );
            } else {
              this.txId = urlMatch[0];
              const vout = parseInt(urlMatch[1], 10);
              if (urlMatch.length > 1 && !isNaN(vout)) {
                // rewrite legacy vout syntax
                this.fragmentParams.set('vout', vout.toString());
                this.fragmentParams.delete('vin');
                this.router.navigate(
                  [this.relativeUrlPipe.transform('/tx'), this.txId],
                  {
                    queryParamsHandling: 'merge',
                    fragment: this.fragmentParams.toString(),
                  }
                );
              }
            }
            if (this.network === '' && this.txId) {
              this.duplicateTxBlocks =
                DUPLICATE_TX_BLOCKS[this.txId?.toLowerCase()];
            }
            if (window.innerWidth <= 767.98) {
              this.router.navigate(
                [this.relativeUrlPipe.transform('/tx'), this.txId],
                {
                  queryParamsHandling: 'merge',
                  preserveFragment: true,
                  queryParams: { mode: 'details' },
                  replaceUrl: true,
                }
              );
            }
            this.seoService.setTitle(
              $localize`:@@bisq.transaction.browser-title:Transaction: ${this.txId}:INTERPOLATION:`
            );
            const seoDescription = seoDescriptionNetwork(
              this.stateService.network
            );
            this.seoService.setDescription(
              $localize`Get real-time status, addresses, fees, script info, and more for Bitcoin Cash${seoDescription} transaction with txid ${this.txId}.`
            );
            this.resetTransaction();
            return merge(
              of(true),
              this.stateService.connectionState$.pipe(
                filter(
                  (state) =>
                    state === 2 && this.tx && !this.tx.status?.confirmed
                )
              )
            );
          }),
          switchMap(() => {
            let transactionObservable$: Observable<Transaction>;
            const cached = this.cacheService.getTxFromCache(this.txId);
            if (cached && cached.fee !== -1) {
              transactionObservable$ = of(cached);
            } else {
              transactionObservable$ = this.electrsApiService
                .getTransaction$(this.txId)
                .pipe(
                  catchError(this.handleLoadElectrsTransactionError.bind(this))
                );
            }
            return merge(
              transactionObservable$,
              this.stateService.mempoolTransactions$
            );
          }),
          switchMap((tx) => {
            return of(tx);
          })
        )
      )
      .subscribe(
        (tx: Transaction) => {
          if (!tx) {
            // this.fetchCachedTx$.next(this.txId);
            this.seoService.logSoft404();
            return;
          }
          this.seoService.clearSoft404();

          this.tx = tx;
          this.setFeatures();
          this.isCached = false;
          if (tx.fee === undefined) {
            this.tx.fee = 0;
          }
          if (this.tx.sigops != null) {
            this.sigops = this.tx.sigops;
            this.adjustedSize = Math.max(this.tx.size, this.sigops * 5);
          }
          this.tx.feePerSize = tx.fee / this.tx.size;
          this.txChanged$.next(true);
          this.isLoadingTx = false;
          this.error = undefined;
          this.loadingCachedTx = false;
          this.waitingForTransaction = false;
          this.websocketService.startTrackTransaction(tx.txid);
          this.graphExpanded = false;
          this.setupGraph();

          if (!tx.status?.confirmed) {
            if (tx.firstSeen) {
              this.transactionTime = tx.firstSeen;
            } else {
              this.transactionTimes$.next(tx.txid);
            }
          } else {
            this.fetchMiningInfo$.next({
              hash: tx.status.block_hash,
              height: tx.status.block_height,
              txid: tx.txid,
            });
            this.transactionTime = 0;
          }

          if (this.tx?.status?.confirmed) {
            this.stateService.markBlock$.next({
              blockHeight: tx.status.block_height,
            });
          }
          this.currencyChangeSubscription?.unsubscribe();
          this.currencyChangeSubscription = this.stateService.fiatCurrency$
            .pipe(
              switchMap((currency) => {
                return tx.status.block_time
                  ? this.priceService
                      .getBlockPrice$(tx.status.block_time, true, currency)
                      .pipe(tap((price) => (tx['price'] = price)))
                  : of(undefined);
              })
            )
            .subscribe();

          this.cd.detectChanges();
        },
        (error) => {
          this.error = error;
          this.seoService.logSoft404();
          this.isLoadingTx = false;
        }
      );

    this.txConfirmedSubscription = this.stateService.txConfirmed$.subscribe(
      ([txConfirmed, block]) => {
        if (
          txConfirmed &&
          this.tx &&
          !this.tx.status.confirmed &&
          txConfirmed === this.tx.txid
        ) {
          this.tx.status = {
            confirmed: true,
            block_height: block.height,
            block_hash: block.id,
            block_time: block.timestamp,
          };
          this.pool = block.extras.pool;
          this.txChanged$.next(true);
          this.stateService.markBlock$.next({ blockHeight: block.height });
          // this.audioService.playSound('wind-chimes-harp-ascend');
          this.audioService.playSound('magic');
          this.fetchMiningInfo$.next({
            hash: block.id,
            height: block.height,
            txid: this.tx.txid,
          });
        }
      }
    );

    this.queryParamsSubscription = this.route.queryParams.subscribe(
      (params) => {
        if (params['showFlow'] === 'false') {
          this.overrideFlowPreference = false;
        } else if (params['showFlow'] === 'true') {
          this.overrideFlowPreference = true;
        } else {
          this.overrideFlowPreference = null;
        }
        this.setFlowEnabled();
        this.setGraphSize();
      }
    );

    this.mempoolBlocksSubscription = this.stateService.mempoolBlocks$.subscribe(
      (mempoolBlocks) => {
        this.now = Date.now();

        if (!this.tx || this.mempoolPosition) {
          return;
        }

        const txfeePerSize = this.tx.feePerSize || this.tx.fee / this.tx.size;
        let found = false;
        this.txInBlockIndex = 0;
        for (const block of mempoolBlocks) {
          for (let i = 0; i < block.feeRange.length - 1 && !found; i++) {
            if (
              txfeePerSize <= block.feeRange[i + 1] &&
              txfeePerSize >= block.feeRange[i]
            ) {
              this.txInBlockIndex = mempoolBlocks.indexOf(block);
              found = true;
            }
          }
        }
        if (
          !found &&
          mempoolBlocks.length &&
          txfeePerSize < mempoolBlocks[mempoolBlocks.length - 1].feeRange[0]
        ) {
          this.txInBlockIndex = 7;
        }
      }
    );

    this.ETA$ = combineLatest([
      this.stateService.mempoolTxPosition$.pipe(startWith(null)),
      this.stateService.mempoolBlocks$.pipe(startWith(null)),
      this.stateService.difficultyAdjustment$.pipe(startWith(null)),
      this.txChanged$,
    ]).pipe(
      map(([position, mempoolBlocks, da]) => {
        return this.etaService.calculateETA(
          this.network,
          this.tx,
          mempoolBlocks,
          position,
          da,
          this.miningStats
        );
      })
    );
  }

  ngAfterViewInit(): void {
    this.setGraphSize();
  }

  handleLoadElectrsTransactionError(error: any): Observable<any> {
    if (error.status === 404 && /^[a-fA-F0-9]{64}$/.test(this.txId)) {
      this.websocketService.startMultiTrackTransaction(this.txId);
      this.waitingForTransaction = true;
    }
    this.error = error;
    this.seoService.logSoft404();
    this.isLoadingTx = false;
    return of(false);
  }

  setFeatures(): void {
    if (this.tx) {
      // No segwit, no taproot, no rbf
      const txHeight =
        this.tx.status?.block_height ||
        (this.stateService.latestBlockHeight >= 0
          ? this.stateService.latestBlockHeight + 1
          : null);
      this.tx.flags = getTransactionFlags(
        this.tx,
        txHeight,
        this.stateService.network
      );
      this.filters = this.tx.flags
        ? toFilters(this.tx.flags).filter((f) => f.txPage)
        : [];
    }
  }

  isAuditAvailable(blockHeight: number): boolean {
    if (!this.auditEnabled) {
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

  isFirstSeenAvailable(blockHeight: number): boolean {
    if (this.stateService.env.BASE_MODULE !== 'explorer') {
      return false;
    }
    switch (this.stateService.network) {
      case 'testnet4':
        if (
          this.stateService.env.TESTNET4_TX_FIRST_SEEN_START_HEIGHT &&
          blockHeight >=
            this.stateService.env.TESTNET4_TX_FIRST_SEEN_START_HEIGHT
        ) {
          return true;
        }
        break;
      case 'scalenet':
        if (
          this.stateService.env.SCALENET_TX_FIRST_SEEN_START_HEIGHT &&
          blockHeight >=
            this.stateService.env.SCALENET_TX_FIRST_SEEN_START_HEIGHT
        ) {
          return true;
        }
        break;
      case 'chipnet':
        if (
          this.stateService.env.CHIPNET_TX_FIRST_SEEN_START_HEIGHT &&
          blockHeight >=
            this.stateService.env.CHIPNET_TX_FIRST_SEEN_START_HEIGHT
        ) {
          return true;
        }
        break;
      default:
        if (
          this.stateService.env.MAINNET_TX_FIRST_SEEN_START_HEIGHT &&
          blockHeight >=
            this.stateService.env.MAINNET_TX_FIRST_SEEN_START_HEIGHT
        ) {
          return true;
        }
    }
    return false;
  }

  resetTransaction() {
    this.firstLoad = false;
    this.gotInitialPosition = false;
    this.error = undefined;
    this.tx = null;
    this.txChanged$.next(true);
    this.setFeatures();
    this.waitingForTransaction = false;
    this.isLoadingTx = true;
    this.transactionTime = -1;
    this.adjustedSize = null;
    this.sigops = null;
    this.hasEffectiveFeeRate = false;
    this.filters = [];
    this.txInBlockIndex = null;
    this.mempoolPosition = null;
    this.pool = null;
    this.auditStatus = null;
    document.body.scrollTo(0, 0);
    this.leaveTransaction();
  }

  leaveTransaction() {
    this.websocketService.stopTrackingTransaction();
    this.stateService.markBlock$.next({});
  }

  setupGraph() {
    this.maxInOut = Math.min(
      this.inOutLimit,
      Math.max(this.tx?.vin?.length || 1, this.tx?.vout?.length + 1 || 1)
    );
    this.graphHeight = this.graphExpanded
      ? this.maxInOut * 15
      : Math.min(360, this.maxInOut * 80);
  }

  toggleGraph() {
    const showFlow = !this.flowEnabled;
    this.stateService.hideFlow.next(!showFlow);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { showFlow: showFlow },
      queryParamsHandling: 'merge',
      fragment: 'flow',
    });
  }

  setFlowEnabled() {
    this.flowEnabled =
      this.overrideFlowPreference != null
        ? this.overrideFlowPreference
        : !this.hideFlow;
  }

  expandGraph() {
    this.graphExpanded = true;
    this.graphHeight = this.maxInOut * 15;
  }

  collapseGraph() {
    this.graphExpanded = false;
    this.graphHeight = Math.min(360, this.maxInOut * 80);
  }

  // simulate normal anchor fragment behavior
  applyFragment(): void {
    const anchor = Array.from(this.fragmentParams.entries()).find(
      ([frag, value]) => value === ''
    );
    if (anchor?.length) {
      const anchorElement = document.getElementById(anchor[0]);
      if (anchorElement) {
        anchorElement.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  updateFragmentParams(fragment: string | null): void {
    this.fragmentParams = new URLSearchParams(fragment || '');
    const vin = parseInt(this.fragmentParams.get('vin'), 10);
    const vout = parseInt(this.fragmentParams.get('vout'), 10);
    this.inputIndex = !isNaN(vin) && vin >= 0 ? vin : null;
    this.outputIndex = !isNaN(vout) && vout >= 0 ? vout : null;
    setTimeout(() => {
      this.applyFragment();
    }, 0);
  }

  @HostListener('window:resize')
  setGraphSize(): void {
    this.isMobile = window.innerWidth < 850;
    if (this.graphContainer?.nativeElement && this.stateService.isBrowser) {
      setTimeout(() => {
        if (this.graphContainer?.nativeElement?.clientWidth) {
          this.graphWidth = this.graphContainer.nativeElement.clientWidth;
        } else {
          setTimeout(() => {
            this.setGraphSize();
          }, 1);
        }
      }, 1);
    }
  }

  isLoggedIn(): boolean {
    const auth = this.storageService.getAuth();
    return auth !== null;
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    this.transactionTimesSubscription.unsubscribe();
    // this.fetchCachedTxSubscription.unsubscribe();
    this.queryParamsSubscription.unsubscribe();
    this.flowPrefSubscription.unsubscribe();
    this.urlFragmentSubscription.unsubscribe();
    this.mempoolBlocksSubscription.unsubscribe();
    this.mempoolPositionSubscription.unsubscribe();
    this.blocksSubscription.unsubscribe();
    this.miningSubscription?.unsubscribe();
    this.auditSubscription?.unsubscribe();
    this.txConfirmedSubscription?.unsubscribe();
    this.currencyChangeSubscription?.unsubscribe();
    this.leaveTransaction();
  }
}
