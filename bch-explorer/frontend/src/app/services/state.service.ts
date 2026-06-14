import { Inject, Injectable, PLATFORM_ID, LOCALE_ID } from '@angular/core';
import {
  ReplaySubject,
  BehaviorSubject,
  Subject,
  fromEvent,
  Observable,
} from 'rxjs';
import { Transaction } from '@app/interfaces/backend-api.interface';
import {
  HealthCheckHost,
  IBackendInfo,
  MempoolBlock,
  MempoolBlockUpdate,
  MempoolInfo,
  Recommendedfees,
  StratumJob,
  isMempoolState,
} from '@interfaces/websocket.interface';
import {
  BlockExtended,
  DifficultyAdjustment,
  MempoolPosition,
  OptimizedMempoolStats,
  TransactionStripped,
} from '@interfaces/node-api.interface';
import { Router, NavigationStart } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { filter, map, scan, share, shareReplay } from 'rxjs/operators';
import { StorageService } from '@app/services/storage.service';
import { hasTouchScreen } from '@app/shared/pipes/bytes-pipe/utils';
import { ActiveFilter } from '@app/shared/filters.utils';

export interface MarkBlockState {
  blockHeight?: number;
  txid?: string;
  mempoolBlockIndex?: number;
  txFeePerSize?: number;
  mempoolPosition?: MempoolPosition;
}

export interface ILoadingIndicators {
  [name: string]: number;
}

export interface Customization {
  theme: string;
  enterprise?: string;
  branding: {
    name: string;
    site_id?: number;
    title: string;
    img?: string;
    header_img?: string;
    footer_img?: string;
    rounded_corner: boolean;
    cobranded?: boolean;
  };
  dashboard: {
    widgets: {
      component: string;
      mobileOrder?: number;
      props: { [key: string]: any };
    }[];
  };
}

export type SignaturesMode = 'all' | 'interesting' | 'none' | null;

export interface Env {
  MAINNET_ENABLED: boolean;
  TESTNET4_ENABLED: boolean;
  SCALENET_ENABLED: boolean;
  CHIPNET_ENABLED: boolean;
  ITEMS_PER_PAGE: number;
  KEEP_BLOCKS_AMOUNT: number;
  OFFICIAL_BCH_EXPLORER: boolean;
  BASE_MODULE: string;
  ROOT_NETWORK: string;
  NGINX_PROTOCOL?: string;
  NGINX_HOSTNAME?: string;
  NGINX_PORT?: string;
  MIN_BLOCK_SIZE_UNITS: number;
  MEMPOOL_BLOCKS_AMOUNT: number;
  GIT_COMMIT_HASH: string;
  GIT_COMMIT_HASH_MEMPOOL_SPACE?: string; // In case of multiple servers deployments
  PACKAGE_JSON_VERSION: string;
  PACKAGE_JSON_VERSION_MEMPOOL_SPACE?: string; // in case of multiple servers deployments
  WEBSITE_URL: string;
  MINING_DASHBOARD: boolean;
  AUDIT: boolean;
  MAINNET_BLOCK_AUDIT_START_HEIGHT: number;
  TESTNET4_BLOCK_AUDIT_START_HEIGHT: number;
  SCALENET_BLOCK_AUDIT_START_HEIGHT: number;
  CHIPNET_BLOCK_AUDIT_START_HEIGHT: number;
  MAINNET_TX_FIRST_SEEN_START_HEIGHT: number;
  TESTNET4_TX_FIRST_SEEN_START_HEIGHT: number;
  SCALENET_TX_FIRST_SEEN_START_HEIGHT: number;
  CHIPNET_TX_FIRST_SEEN_START_HEIGHT: number;
  HISTORICAL_PRICE: boolean;
  ADDITIONAL_CURRENCIES: boolean;
  STRATUM_ENABLED: boolean;
  SERVICES_API?: string;
  BCMR_API: string;
  customize?: Customization;
  PROD_DOMAINS: string[];
  NOTIFICATION_MESSAGE: string;
}

const defaultEnv: Env = {
  MAINNET_ENABLED: true,
  TESTNET4_ENABLED: false,
  SCALENET_ENABLED: false,
  CHIPNET_ENABLED: false,
  BASE_MODULE: 'explorer',
  ROOT_NETWORK: '',
  ITEMS_PER_PAGE: 10,
  KEEP_BLOCKS_AMOUNT: 8,
  OFFICIAL_BCH_EXPLORER: false,
  NGINX_PROTOCOL: 'http',
  NGINX_HOSTNAME: '127.0.0.1',
  NGINX_PORT: '80',
  MIN_BLOCK_SIZE_UNITS: 32000000,
  MEMPOOL_BLOCKS_AMOUNT: 8,
  GIT_COMMIT_HASH: '',
  PACKAGE_JSON_VERSION: '',
  WEBSITE_URL: 'https://bchexplorer.cash',
  MINING_DASHBOARD: true,
  AUDIT: false,
  MAINNET_BLOCK_AUDIT_START_HEIGHT: 0,
  TESTNET4_BLOCK_AUDIT_START_HEIGHT: 0,
  SCALENET_BLOCK_AUDIT_START_HEIGHT: 0,
  CHIPNET_BLOCK_AUDIT_START_HEIGHT: 0,
  MAINNET_TX_FIRST_SEEN_START_HEIGHT: 0,
  TESTNET4_TX_FIRST_SEEN_START_HEIGHT: 0,
  SCALENET_TX_FIRST_SEEN_START_HEIGHT: 0,
  CHIPNET_TX_FIRST_SEEN_START_HEIGHT: 0,
  HISTORICAL_PRICE: true,
  ADDITIONAL_CURRENCIES: false,
  STRATUM_ENABLED: false,
  SERVICES_API: 'https://bchexplorer.cash/api/v1/services',
  BCMR_API: 'https://bcmr.paytaca.com/api',
  PROD_DOMAINS: [],
  NOTIFICATION_MESSAGE: '',
};

@Injectable({
  providedIn: 'root',
})
export class StateService {
  referrer: string = '';
  isBrowser: boolean;
  isofficialBCHExplorerSiteBuild = window['isOfficialSiteBuild'] ?? false;
  isProdDomain: boolean;
  backend: 'electrum' | 'none' = 'electrum';
  network = '';
  blockSize: number;
  env: Env;
  latestBlockHeight = -1;
  blocks: BlockExtended[] = [];
  mempoolSequence: number;
  mempoolBlockState: {
    block: number;
    transactions: { [txid: string]: TransactionStripped };
  };

  backend$ = new BehaviorSubject<'electrum' | 'none'>('electrum');
  networkChanged$ = new ReplaySubject<string>(1);
  signaturesMode$: BehaviorSubject<SignaturesMode>;
  blocksSubject$ = new BehaviorSubject<BlockExtended[]>([]);
  blocks$: Observable<BlockExtended[]>;
  transactions$ = new BehaviorSubject<TransactionStripped[]>(null);
  conversions$ = new ReplaySubject<Record<string, number>>(1);
  bsqPrice$ = new ReplaySubject<number>(1);
  mempoolInfo$ = new ReplaySubject<MempoolInfo>(1);
  mempoolBlocks$ = new ReplaySubject<MempoolBlock[]>(1);
  mempoolBlockUpdate$ = new Subject<MempoolBlockUpdate>();
  liveMempoolBlockTransactions$: Observable<{
    block: number;
    transactions: { [txid: string]: TransactionStripped };
  }>;
  stratumJobUpdate$ = new Subject<
    { state: Record<string, StratumJob> } | { job: StratumJob }
  >();
  stratumJobs$ = new BehaviorSubject<Record<string, StratumJob>>({});
  txConfirmed$ = new Subject<[string, BlockExtended]>();
  utxoSpent$ = new Subject<object>();
  difficultyAdjustment$ = new ReplaySubject<DifficultyAdjustment>(1);
  mempoolTransactions$ = new Subject<Transaction>();
  mempoolTxPosition$ = new BehaviorSubject<{
    txid: string;
    position: MempoolPosition;
  }>(null);
  mempoolRemovedTransactions$ = new Subject<Transaction>();
  multiAddressTransactions$ = new Subject<{
    [address: string]: {
      mempool: Transaction[];
      confirmed: Transaction[];
      removed: Transaction[];
    };
  }>();
  blockTransactions$ = new Subject<Transaction>();
  walletTransactions$ = new Subject<Transaction[]>();
  isLoadingWebSocket$ = new ReplaySubject<boolean>(1);
  isLoadingMempool$ = new BehaviorSubject<boolean>(true);
  bytesPerSecond$ = new ReplaySubject<number>(1);
  backendInfo$ = new ReplaySubject<IBackendInfo>(1);
  servicesBackendInfo$ = new ReplaySubject<IBackendInfo>(1);
  loadingIndicators$ = new ReplaySubject<ILoadingIndicators>(1);
  recommendedFees$ = new ReplaySubject<Recommendedfees>(1);
  chainTip$ = new ReplaySubject<number>(-1);
  serverHealth$ = new Subject<HealthCheckHost[]>();

  live2Chart$ = new Subject<OptimizedMempoolStats>();

  viewAmountMode$: BehaviorSubject<'bch' | 'sats' | 'fiat'>;
  timezone$: BehaviorSubject<string>;
  connectionState$ = new BehaviorSubject<0 | 1 | 2>(2);
  isTabHidden$: Observable<boolean>;

  markBlock$ = new BehaviorSubject<MarkBlockState>({});
  keyNavigation$ = new Subject<KeyboardEvent>();
  searchText$ = new BehaviorSubject<string>('');

  blockScrolling$: Subject<boolean> = new Subject<boolean>();
  resetScroll$: Subject<boolean> = new Subject<boolean>();
  timeLtr: BehaviorSubject<boolean>;
  hideFlow: BehaviorSubject<boolean>;
  hideAudit: BehaviorSubject<boolean>;
  fiatCurrency$: BehaviorSubject<string>;
  rateUnits$: BehaviorSubject<string>;
  blockDisplayMode$: BehaviorSubject<string>;

  searchFocus$: Subject<boolean> = new Subject<boolean>();
  menuOpen$: BehaviorSubject<boolean> = new BehaviorSubject(false);

  activeGoggles$: BehaviorSubject<ActiveFilter> = new BehaviorSubject({
    mode: 'and',
    filters: [],
    gradient: 'age',
  });

  constructor(
    @Inject(PLATFORM_ID) private platformId: any,
    @Inject(LOCALE_ID) private locale: string,
    private router: Router,
    private storageService: StorageService
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    this.referrer = window.document.referrer;

    const browserWindow = window || {};
    // @ts-ignore
    const browserWindowEnv = browserWindow.__env || {};
    if (
      browserWindowEnv.PROD_DOMAINS &&
      typeof browserWindowEnv.PROD_DOMAINS === 'string'
    ) {
      browserWindowEnv.PROD_DOMAINS = browserWindowEnv.PROD_DOMAINS.split(',');
    }

    this.env = Object.assign(defaultEnv, browserWindowEnv);

    if (defaultEnv.BASE_MODULE !== 'explorer') {
      this.env.MINING_DASHBOARD = false;
    }

    if (document.location.hostname.endsWith('.onion')) {
      this.env.SERVICES_API = 'http://sometoraddress.onion/api/v1/services';
    }

    if (this.isBrowser) {
      this.setNetworkBasedonUrl(window.location.pathname);
      this.isTabHidden$ = fromEvent(document, 'visibilitychange').pipe(
        map(() => this.isHidden()),
        shareReplay()
      );
    } else {
      this.setNetworkBasedonUrl('/');
      this.isTabHidden$ = new BehaviorSubject(false);
    }

    this.isProdDomain = this.testIsProdDomain(this.env.PROD_DOMAINS);

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.setNetworkBasedonUrl(event.url);
      }
    });

    this.liveMempoolBlockTransactions$ = this.mempoolBlockUpdate$.pipe(
      scan(
        (
          acc: {
            block: number;
            transactions: { [txid: string]: TransactionStripped };
          },
          change: MempoolBlockUpdate
        ): {
          block: number;
          transactions: { [txid: string]: TransactionStripped };
        } => {
          if (isMempoolState(change)) {
            const txMap = {};
            change.transactions.forEach((tx) => {
              txMap[tx.txid] = tx;
            });
            this.mempoolBlockState = {
              block: change.block,
              transactions: txMap,
            };
            return this.mempoolBlockState;
          } else {
            change.added.forEach((tx) => {
              acc.transactions[tx.txid] = tx;
            });
            change.removed.forEach((txid) => {
              delete acc.transactions[txid];
            });
            change.changed.forEach((tx) => {
              if (acc.transactions[tx.txid]) {
                acc.transactions[tx.txid].rate = tx.rate;
              }
            });
            this.mempoolBlockState = {
              block: change.block,
              transactions: acc.transactions,
            };
            return this.mempoolBlockState;
          }
        },
        {}
      ),
      share()
    );
    this.liveMempoolBlockTransactions$.subscribe();

    this.stratumJobUpdate$
      .pipe(
        scan(
          (
            acc: Record<string, StratumJob>,
            update: { state: Record<string, StratumJob> } | { job: StratumJob }
          ) => {
            if ('state' in update) {
              // Replace the entire state
              return update.state;
            } else {
              // Update or create a single job entry
              return {
                ...acc,
                [update.job.pool]: update.job,
              };
            }
          },
          {}
        ),
        shareReplay(1)
      )
      .subscribe((val) => {
        this.stratumJobs$.next(val);
      });

    this.networkChanged$.subscribe((network) => {
      this.transactions$ = new BehaviorSubject<TransactionStripped[]>(null);
      this.stratumJobs$ = new BehaviorSubject<Record<string, StratumJob>>({});
      this.stratumJobUpdate$.next({ state: {} });
      this.blocksSubject$.next([]);
    });

    this.signaturesMode$ = new BehaviorSubject<SignaturesMode>(
      (this.storageService.getValue('signatures-mode') as SignaturesMode) ||
        null
    );

    this.blockSize = this.env.MIN_BLOCK_SIZE_UNITS;

    this.blocks$ = this.blocksSubject$.pipe(
      filter((blocks) => blocks != null && blocks.length > 0)
    );

    const savedTimePreference = this.storageService.getValue(
      'time-preference-ltr'
    );
    const rtlLanguage =
      this.locale.startsWith('ar') ||
      this.locale.startsWith('fa') ||
      this.locale.startsWith('he');
    // default time direction is right-to-left, unless locale is a RTL language
    this.timeLtr = new BehaviorSubject<boolean>(
      savedTimePreference === 'true' ||
        (savedTimePreference == null && rtlLanguage)
    );
    this.timeLtr.subscribe((ltr) => {
      this.storageService.setValue(
        'time-preference-ltr',
        ltr ? 'true' : 'false'
      );
    });

    const savedFlowPreference = this.storageService.getValue('flow-preference');
    this.hideFlow = new BehaviorSubject<boolean>(
      savedFlowPreference === 'hide'
    );
    this.hideFlow.subscribe((hide) => {
      if (hide) {
        this.storageService.setValue('flow-preference', hide ? 'hide' : 'show');
      } else {
        this.storageService.removeItem('flow-preference');
      }
    });

    const savedAuditPreference =
      this.storageService.getValue('audit-preference');
    this.hideAudit = new BehaviorSubject<boolean>(
      savedAuditPreference === 'hide'
    );
    this.hideAudit.subscribe((hide) => {
      this.storageService.setValue('audit-preference', hide ? 'hide' : 'show');
    });

    const fiatPreference = this.storageService.getValue('fiat-preference');
    this.fiatCurrency$ = new BehaviorSubject<string>(fiatPreference || 'USD');

    const rateUnitPreference = this.storageService.getValue(
      'rate-unit-preference'
    );
    this.rateUnits$ = new BehaviorSubject<string>(rateUnitPreference || 'b');

    const blockDisplayModePreference = this.storageService.getValue(
      'block-display-mode-preference'
    );
    this.blockDisplayMode$ = new BehaviorSubject<string>(
      blockDisplayModePreference || 'fees'
    );

    const viewAmountModePreference = this.storageService.getValue(
      'view-amount-mode'
    ) as 'bch' | 'sats' | 'fiat';
    this.viewAmountMode$ = new BehaviorSubject<'bch' | 'sats' | 'fiat'>(
      viewAmountModePreference || 'bch'
    );

    const timezonePreference = this.storageService.getValue(
      'timezone-preference'
    );
    this.timezone$ = new BehaviorSubject<string>(timezonePreference || 'local');

    this.backend$.subscribe((backend) => {
      this.backend = backend;
    });
  }

  setNetworkBasedonUrl(url: string) {
    if (this.env.BASE_MODULE !== 'explorer') {
      return;
    }
    // horrible network regex breakdown:
    // /^\/                                         starts with a forward slash...
    // (?:[a-z]{2}(?:-[A-Z]{2})?\/)?                optional locale prefix (non-capturing)
    // (?:preview\/)?                               optional "preview" prefix (non-capturing)
    // (testnet4|scalenet|chipnet)/                 network string (captured as networkMatches[1])
    // ($|\/)                                       network string must end or end with a slash
    let networkMatches: object = url.match(
      /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(?:preview\/)?(testnet4|scalenet|chipnet)($|\/)/
    );

    if (!networkMatches && this.env.ROOT_NETWORK) {
      networkMatches = { 1: this.env.ROOT_NETWORK };
    }

    switch (networkMatches && networkMatches[1]) {
      case 'testnet4':
        if (this.network !== 'testnet4') {
          this.network = 'testnet4';
          this.networkChanged$.next('testnet4');
        }
        return;
      case 'scalenet':
        if (this.network !== 'scalenet') {
          this.network = 'scalenet';
          this.networkChanged$.next('scalenet');
        }
        return;
      case 'chipnet':
        if (this.network !== 'chipnet') {
          this.network = 'chipnet';
          this.networkChanged$.next('chipnet');
        }
        return;
      default:
        if (this.env.BASE_MODULE !== 'explorer') {
          if (this.network !== this.env.BASE_MODULE) {
            this.network = this.env.BASE_MODULE;
            this.networkChanged$.next(this.env.BASE_MODULE);
          }
        } else if (this.network !== '') {
          this.network = '';
          this.networkChanged$.next('');
        }
    }
  }

  getHiddenProp() {
    const prefixes = ['webkit', 'moz', 'ms', 'o'];
    if ('hidden' in document) {
      return 'hidden';
    }
    for (const prefix of prefixes) {
      if (prefix + 'Hidden' in document) {
        return prefix + 'Hidden';
      }
    }
    return null;
  }

  isHidden() {
    const prop = this.getHiddenProp();
    if (!prop) {
      return false;
    }
    return document[prop];
  }

  setBlockScrollingInProgress(value: boolean) {
    this.blockScrolling$.next(value);
  }

  isMainnet(): boolean {
    return this.env.ROOT_NETWORK === '' && this.network === '';
  }

  isAnyTestnet(): boolean {
    return ['testnet4', 'scalenet', 'chipnet'].includes(this.network);
  }

  resetChainTip() {
    this.latestBlockHeight = -1;
    this.chainTip$.next(-1);
  }

  updateChainTip(height) {
    if (height > this.latestBlockHeight) {
      this.latestBlockHeight = height;
      this.chainTip$.next(height);
    }
  }

  resetBlocks(blocks: BlockExtended[]): void {
    this.blocks = blocks.reverse();
    this.blocksSubject$.next(blocks);
  }

  addBlock(block: BlockExtended): void {
    this.blocks.unshift(block);
    this.blocks = this.blocks.slice(0, this.env.KEEP_BLOCKS_AMOUNT);
    this.blocksSubject$.next(this.blocks);
  }

  focusSearchInputDesktop() {
    if (!hasTouchScreen()) {
      this.searchFocus$.next(true);
    }
  }

  private testIsProdDomain(prodDomains: string[]): boolean {
    const hostname = document.location.hostname;
    return prodDomains.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );
  }
}
