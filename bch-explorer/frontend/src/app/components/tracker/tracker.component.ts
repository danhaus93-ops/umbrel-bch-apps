import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  Inject,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  NgZone,
} from '@angular/core';
import { ElectrsApiService } from '@app/services/backend-api.service';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import {
  switchMap,
  filter,
  catchError,
  tap,
  map,
  startWith,
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
import { seoDescriptionNetwork } from '@app/shared/common.utils';
import { Filter } from '@app/shared/filters.utils';
import {
  BlockExtended,
  MempoolPosition,
  DifficultyAdjustment,
} from '@interfaces/node-api.interface';
import { PriceService } from '@app/services/price.service';
import { EnterpriseService } from '@app/services/enterprise.service';
import { ZONE_SERVICE } from '@app/injection-tokens';
import { TrackerStage } from '@components/tracker/tracker-bar.component';
import { MiningService, MiningStats } from '@app/services/mining.service';
import { ETA, EtaService } from '@app/services/eta.service';

interface Pool {
  id: number;
  name: string;
  slug: string;
}

interface AuditStatus {
  seen?: boolean;
  expected?: boolean;
  added?: boolean;
  delayed?: number;
  conflict?: boolean;
  coinbase?: boolean;
}

@Component({
  selector: 'app-tracker',
  templateUrl: './tracker.component.html',
  styleUrls: ['./tracker.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackerComponent implements OnInit, OnDestroy {
  network = '';
  tx: Transaction;
  txId: string;
  txInBlockIndex: number;
  mempoolPosition: MempoolPosition;
  isLoadingTx = true;
  loadingCachedTx = false;
  loadingPosition = true;
  error: any = undefined;
  waitingForTransaction = false;
  latestBlock: BlockExtended;
  transactionTime = -1;
  subscription: Subscription;
  mempoolPositionSubscription: Subscription;
  mempoolBlocksSubscription: Subscription;
  blocksSubscription: Subscription;
  miningSubscription: Subscription;
  currencyChangeSubscription: Subscription;
  sigops: number | null;
  adjustedSize: number | null;
  pool: Pool | null;
  auditStatus: AuditStatus | null;
  filters: Filter[] = [];
  miningStats: MiningStats;
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
  isMobile: boolean;

  trackerStage: TrackerStage = 'waiting';

  blockchainHeight: number = 100;
  blockchainWidth: number = 600;

  hasEffectiveFeeRate: boolean;
  accelerateCtaType: 'alert' | 'button' = 'button';
  paymentReceiptUrl: string | null = null;
  auditEnabled: boolean;

  enterpriseInfo: any;
  enterpriseInfo$: Subscription;
  officialSite: boolean;

  constructor(
    private route: ActivatedRoute,
    private electrsApiService: ElectrsApiService,
    public stateService: StateService,
    private etaService: EtaService,
    private cacheService: CacheService,
    private websocketService: WebsocketService,
    private audioService: AudioService,
    private apiService: ApiService,
    private seoService: SeoService,
    private priceService: PriceService,
    private enterpriseService: EnterpriseService,
    private miningService: MiningService,
    private cd: ChangeDetectorRef,
    private zone: NgZone,
    @Inject(ZONE_SERVICE) private zoneService: any
  ) {}

  ngOnInit() {
    this.auditEnabled =
      this.stateService.env.AUDIT &&
      this.stateService.env.BASE_MODULE === 'explorer' &&
      this.stateService.env.MINING_DASHBOARD === true;
    this.officialSite = this.stateService.env.OFFICIAL_BCH_EXPLORER;

    this.onResize();

    this.miningService.getMiningStats('1w').subscribe((stats) => {
      this.miningStats = stats;
    });

    this.enterpriseService.page();

    this.enterpriseInfo$ = this.enterpriseService.info$.subscribe((info) => {
      this.enterpriseInfo = info;
    });

    this.websocketService.want(['blocks', 'mempool-blocks']);
    this.stateService.networkChanged$.subscribe((network) => {
      this.network = network;
    });

    this.da$ = this.stateService.difficultyAdjustment$.pipe(
      tap(() => {
        this.now = Date.now();
      })
    );

    this.blocksSubscription = this.stateService.blocks$.subscribe((blocks) => {
      this.latestBlock = blocks[0];
    });

    this.miningSubscription = this.fetchMiningInfo$
      .pipe(
        filter((target) => target.txid === this.txId),
        tap(() => {
          this.pool = null;
          this.auditStatus = null;
        }),
        switchMap(({ hash, height, txid }) => {
          const foundBlock = this.cacheService.getCachedBlock(height) || null;
          const auditAvailable = this.isAuditAvailable(height);
          const isCoinbase = this.tx.vin.some((v) => v.is_coinbase);
          const fetchAudit = auditAvailable && !isCoinbase;
          return combineLatest([
            foundBlock
              ? of(foundBlock.extras.pool)
              : this.apiService.getBlock$(hash).pipe(
                  map((block) => {
                    return block.extras.pool;
                  }),
                  catchError(() => {
                    return of(null);
                  })
                ),
            fetchAudit
              ? this.apiService.getBlockAudit$(hash).pipe(
                  map((audit) => {
                    const isAdded = audit.addedTxs.includes(txid);
                    const isExpected = audit.template.some(
                      (tx) => tx.txid === txid
                    );
                    return {
                      seen: isExpected,
                      expected: isExpected,
                      added: isAdded,
                    };
                  }),
                  catchError(() => {
                    return of(null);
                  })
                )
              : of(isCoinbase ? { coinbase: true } : null),
          ]);
        }),
        catchError(() => {
          return of(null);
        })
      )
      .subscribe(([pool, auditStatus]) => {
        this.pool = pool;
        this.auditStatus = auditStatus;
      });

    this.mempoolPositionSubscription =
      this.stateService.mempoolTxPosition$.subscribe((txPosition) => {
        this.now = Date.now();
        if (
          txPosition &&
          txPosition.txid === this.txId &&
          txPosition.position
        ) {
          this.loadingPosition = false;
          this.mempoolPosition = txPosition.position;
          if (this.tx && !this.tx.status.confirmed) {
            const txFeePerSize = this.tx.feePerSize;
            this.stateService.markBlock$.next({
              txid: txPosition.txid,
              txFeePerSize,
              mempoolPosition: this.mempoolPosition,
            });
            this.txInBlockIndex = this.mempoolPosition.block;
          }
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
            } else {
              this.txId = urlMatch[0];
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
          })
        )
      )
      .subscribe(
        (tx: Transaction) => {
          if (!tx) {
            this.loadingPosition = false;
            this.seoService.logSoft404();
            return;
          }
          this.seoService.clearSoft404();

          this.tx = tx;
          this.isCached = false;
          if (tx.fee === undefined) {
            this.tx.fee = 0;
          }
          if (this.tx.sigops != null) {
            this.sigops = this.tx.sigops;
            this.adjustedSize = Math.max(this.tx.size, this.sigops * 5);
          }
          this.tx.feePerSize = tx.fee / tx.size;
          this.txChanged$.next(true);
          this.isLoadingTx = false;
          this.error = undefined;
          this.loadingCachedTx = false;
          this.waitingForTransaction = false;
          this.websocketService.startTrackTransaction(tx.txid);

          if (!tx.status?.confirmed) {
            this.trackerStage = 'pending';
            if (tx.firstSeen) {
              this.transactionTime = tx.firstSeen;
            } else {
              this.getTransactionTime();
            }
          } else {
            this.trackerStage = 'confirmed';
            this.loadingPosition = false;
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

    this.stateService.txConfirmed$.subscribe(([txConfirmed, block]) => {
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
        this.txChanged$.next(true);
        this.trackerStage = 'confirmed';
        this.stateService.markBlock$.next({ blockHeight: block.height });
        this.audioService.playSound('magic');
        this.fetchMiningInfo$.next({
          hash: block.id,
          height: block.height,
          txid: this.tx.txid,
        });
      }
    });

    this.mempoolBlocksSubscription = this.stateService.mempoolBlocks$.subscribe(
      (mempoolBlocks) => {
        this.now = Date.now();

        if (!this.tx || this.mempoolPosition) {
          return;
        }

        const txFeePerSize = this.tx.feePerSize || this.tx.fee / this.tx.size;

        let found = false;
        this.txInBlockIndex = 0;
        for (const block of mempoolBlocks) {
          for (let i = 0; i < block.feeRange.length - 1 && !found; i++) {
            if (
              txFeePerSize <= block.feeRange[i + 1] &&
              txFeePerSize >= block.feeRange[i]
            ) {
              this.txInBlockIndex = mempoolBlocks.indexOf(block);
              found = true;
            }
          }
        }
        if (
          !found &&
          mempoolBlocks.length &&
          txFeePerSize < mempoolBlocks[mempoolBlocks.length - 1].feeRange[0]
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
      filter(([position, mempoolBlocks, da]) => {
        return (
          this.tx &&
          !this.tx?.status?.confirmed &&
          position &&
          this.tx.txid === position.txid
        );
      }),
      map(([position, mempoolBlocks, da]) => {
        return this.etaService.calculateETA(
          this.network,
          this.tx,
          mempoolBlocks,
          position,
          da,
          this.miningStats
        );
      }),
      tap((eta) => {
        if (eta?.blocks === 0) {
          this.trackerStage = 'next';
        } else if (eta?.blocks < 3) {
          this.trackerStage = 'soon';
        } else {
          this.trackerStage = 'pending';
        }
      })
    );
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

  getTransactionTime() {
    this.apiService
      .getTransactionTimes$([this.tx.txid])
      .subscribe((transactionTimes) => {
        if (transactionTimes?.length) {
          this.transactionTime = transactionTimes[0];
        }
      });
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

  paymentReceipt(ev) {
    if (ev?.length) {
      this.paymentReceiptUrl = ev;
    }
  }

  get isLoading(): boolean {
    return this.isLoadingTx || this.loadingCachedTx || this.loadingPosition;
  }

  resetTransaction() {
    this.error = undefined;
    this.tx = null;
    this.txChanged$.next(true);
    this.waitingForTransaction = false;
    this.isLoadingTx = true;
    this.loadingPosition = true;
    this.transactionTime = -1;
    this.adjustedSize = null;
    this.sigops = null;
    this.hasEffectiveFeeRate = false;
    this.filters = [];
    this.mempoolPosition = null;
    this.pool = null;
    this.auditStatus = null;
    this.trackerStage = 'waiting';
    document.body.scrollTo(0, 0);
    this.leaveTransaction();
  }

  leaveTransaction() {
    this.websocketService.stopTrackingTransaction();
    this.stateService.markBlock$.next({});
  }

  roundToOneDecimal(tx: any): number {
    return +(tx.fee / tx.size).toFixed(1);
  }

  @HostListener('window:resize')
  onResize(): void {
    this.isMobile = window.innerWidth < 850;
    this.blockchainWidth = Math.min(600, window.innerWidth);
    this.blockchainHeight = this.blockchainWidth / 5;
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    this.mempoolBlocksSubscription.unsubscribe();
    this.mempoolPositionSubscription.unsubscribe();
    this.mempoolBlocksSubscription.unsubscribe();
    this.blocksSubscription.unsubscribe();
    this.miningSubscription?.unsubscribe();
    this.currencyChangeSubscription?.unsubscribe();
    this.enterpriseInfo$?.unsubscribe();
    this.leaveTransaction();
  }
}
