import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import {
  OptimizedMempoolStats,
  AddressInformation,
  ITranslators,
  PoolStat,
  BlockExtended,
  TransactionStripped,
  RewardStats,
  AuditScore,
  BlockSizes,
  BlockTimeDiffs,
  BlockTxCounts,
  UtxoSize,
  BlockAudit,
  TestMempoolAcceptResult,
  WalletAddress,
  Treasury,
  SubmitPackageResult,
  ChainTip,
  StaleTip,
} from '@interfaces/node-api.interface';
import {
  BehaviorSubject,
  Observable,
  catchError,
  filter,
  map,
  of,
  shareReplay,
  take,
  tap,
} from 'rxjs';
import { StateService } from '@app/services/state.service';
import { Conversion } from '@app/services/price.service';
import { WebsocketResponse } from '@interfaces/websocket.interface';
import { TxAuditStatus } from '@components/transaction/transaction.component';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private apiBaseUrl: string; // base URL is protocol, hostname, and port
  private apiBasePath: string; // network path is /testnet, etc. or '' for mainnet

  private requestCache = new Map<
    string,
    { subject: BehaviorSubject<any>; expiry: number }
  >();
  public blockSummaryLoaded: { [hash: string]: boolean } = {};
  public blockAuditLoaded: { [hash: string]: boolean } = {};

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService
  ) {
    this.apiBaseUrl = ''; // use relative URL by default
    if (!stateService.isBrowser) {
      // except when inside AU SSR process
      this.apiBaseUrl =
        this.stateService.env.NGINX_PROTOCOL +
        '://' +
        this.stateService.env.NGINX_HOSTNAME +
        ':' +
        this.stateService.env.NGINX_PORT;
    }
    this.apiBasePath = ''; // assume mainnet by default
    this.stateService.networkChanged$.subscribe((network) => {
      this.apiBasePath =
        network && network !== this.stateService.env.ROOT_NETWORK
          ? '/' + network
          : '';
    });
  }

  private generateCacheKey(functionName: string, params: any[]): string {
    return functionName + JSON.stringify(params);
  }

  // delete expired cache entries
  private cleanExpiredCache(): void {
    this.requestCache.forEach((value, key) => {
      if (value.expiry < Date.now()) {
        this.requestCache.delete(key);
      }
    });
  }

  cachedRequest<T, F extends (...args: any[]) => Observable<T>>(
    apiFunction: F,
    expireAfter: number, // in ms
    ...params: Parameters<F>
  ): Observable<T> {
    this.cleanExpiredCache();

    const cacheKey = this.generateCacheKey(apiFunction.name, params);
    if (!this.requestCache.has(cacheKey)) {
      const subject = new BehaviorSubject<T | null>(null);
      this.requestCache.set(cacheKey, {
        subject,
        expiry: Date.now() + expireAfter,
      });

      apiFunction
        .bind(this)(...params)
        .pipe(
          tap((data) => {
            subject.next(data as T);
          }),
          catchError((error) => {
            subject.error(error);
            return of(null);
          }),
          shareReplay(1)
        )
        .subscribe();
    }

    return this.requestCache
      .get(cacheKey)
      .subject.asObservable()
      .pipe(
        filter((val) => val !== null),
        take(1)
      );
  }

  list2HStatistics$(): Observable<OptimizedMempoolStats[]> {
    return this.httpClient.get<OptimizedMempoolStats[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/statistics/2h'
    );
  }

  list24HStatistics$(): Observable<OptimizedMempoolStats[]> {
    return this.httpClient.get<OptimizedMempoolStats[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/statistics/24h'
    );
  }

  list3DStatistics$(): Observable<OptimizedMempoolStats[]> {
    return this.httpClient.get<OptimizedMempoolStats[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/statistics/3d'
    );
  }

  list1WStatistics$(): Observable<OptimizedMempoolStats[]> {
    return this.httpClient.get<OptimizedMempoolStats[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/statistics/1w'
    );
  }

  list1MStatistics$(): Observable<OptimizedMempoolStats[]> {
    return this.httpClient.get<OptimizedMempoolStats[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/statistics/1m'
    );
  }

  list3MStatistics$(): Observable<OptimizedMempoolStats[]> {
    return this.httpClient.get<OptimizedMempoolStats[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/statistics/3m'
    );
  }

  list6MStatistics$(): Observable<OptimizedMempoolStats[]> {
    return this.httpClient.get<OptimizedMempoolStats[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/statistics/6m'
    );
  }

  list1YStatistics$(): Observable<OptimizedMempoolStats[]> {
    return this.httpClient.get<OptimizedMempoolStats[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/statistics/1y'
    );
  }

  list2YStatistics$(): Observable<OptimizedMempoolStats[]> {
    return this.httpClient.get<OptimizedMempoolStats[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/statistics/2y'
    );
  }

  list3YStatistics$(): Observable<OptimizedMempoolStats[]> {
    return this.httpClient.get<OptimizedMempoolStats[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/statistics/3y'
    );
  }

  list4YStatistics$(): Observable<OptimizedMempoolStats[]> {
    return this.httpClient.get<OptimizedMempoolStats[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/statistics/4y'
    );
  }

  listAllTimeStatistics$(): Observable<OptimizedMempoolStats[]> {
    return this.httpClient.get<OptimizedMempoolStats[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/statistics/all'
    );
  }

  getTransactionTimes$(txIds: string[]): Observable<number[]> {
    let params = new HttpParams();
    txIds.forEach((txId: string) => {
      params = params.append('txId[]', txId);
    });
    return this.httpClient.get<number[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/transaction-times',
      { params }
    );
  }

  getAboutPageProfiles$(): Observable<any[]> {
    return this.httpClient.get<any[]>(
      this.apiBaseUrl + '/api/v1/services/sponsors'
    );
  }

  getOgs$(): Observable<any> {
    return this.httpClient.get<any[]>(this.apiBaseUrl + '/api/v1/donations');
  }

  getTranslators$(): Observable<ITranslators> {
    return this.httpClient.get<ITranslators>(
      this.apiBaseUrl + '/api/v1/translators'
    );
  }

  getContributor$(): Observable<any[]> {
    return this.httpClient.get<any[]>(this.apiBaseUrl + '/api/v1/contributors');
  }

  getInitData$(): Observable<WebsocketResponse> {
    return this.httpClient.get<WebsocketResponse>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/init-data'
    );
  }

  validateAddress$(address: string): Observable<AddressInformation> {
    return this.httpClient.get<AddressInformation>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/validate-address/' + address
    );
  }

  getChainTips$(): Observable<ChainTip[]> {
    return this.httpClient.get<ChainTip[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/chain-tips'
    );
  }

  getStaleTips$(): Observable<StaleTip[]> {
    return this.httpClient.get<StaleTip[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/stale-tips'
    );
  }

  postTransaction$(hexPayload: string): Observable<any> {
    return this.httpClient.post<any>(
      this.apiBaseUrl + this.apiBasePath + '/api/tx',
      hexPayload,
      { responseType: 'text' as 'json' }
    );
  }

  testTransactions$(
    rawTxs: string[],
    allowhighfees?: boolean
  ): Observable<TestMempoolAcceptResult[]> {
    return this.httpClient.post<TestMempoolAcceptResult[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/txs/test${
          allowhighfees ? '?allowhighfees=' + (allowhighfees ? '1' : '0') : ''
        }`,
      rawTxs
    );
  }

  submitPackage$(
    rawTxs: string[],
    allowhighfees?: boolean
  ): Observable<SubmitPackageResult> {
    const queryParams = [];

    if (allowhighfees) {
      queryParams.push(`allowhighfees=${allowhighfees ? '1' : '0'}`);
    }

    return this.httpClient.post<SubmitPackageResult>(
      this.apiBaseUrl +
        this.apiBasePath +
        '/api/v1/txs/package' +
        (queryParams.length > 0 ? `?${queryParams.join('&')}` : ''),
      rawTxs
    );
  }

  getTransactionStatus$(txid: string): Observable<any> {
    return this.httpClient.get<any>(
      this.apiBaseUrl + this.apiBasePath + '/api/tx/' + txid + '/status'
    );
  }

  listPools$(interval: string | undefined): Observable<any> {
    return this.httpClient
      .get<any>(
        this.apiBaseUrl +
          this.apiBasePath +
          `/api/v1/mining/pools` +
          (interval !== undefined ? `/${interval}` : ''),
        { observe: 'response' }
      )
      .pipe(
        map((response) => {
          const pools =
            interval !== undefined ? response.body.pools : response.body;
          pools.forEach((pool) => {
            if (
              (interval !== undefined && pool.poolUniqueId === 0) ||
              (interval === undefined && pool.unique_id === 0)
            ) {
              pool.name = $localize`:@@e5d8bb389c702588877f039d72178f219453a72d:Unknown`;
            }
          });
          return response;
        })
      );
  }

  getPoolStats$(slug: string): Observable<PoolStat> {
    return this.httpClient
      .get<PoolStat>(
        this.apiBaseUrl + this.apiBasePath + `/api/v1/mining/pool/${slug}`
      )
      .pipe(
        map((poolStats) => {
          if (poolStats.pool.unique_id === 0) {
            poolStats.pool.name = $localize`:@@e5d8bb389c702588877f039d72178f219453a72d:Unknown`;
          }
          return poolStats;
        })
      );
  }

  getPoolHashrate$(slug: string): Observable<any> {
    return this.httpClient.get<any>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/pool/${slug}/hashrate`
    );
  }

  getPoolBlocks$(
    slug: string,
    fromHeight: number
  ): Observable<BlockExtended[]> {
    return this.httpClient.get<BlockExtended[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/pool/${slug}/blocks` +
        (fromHeight !== undefined ? `/${fromHeight}` : '')
    );
  }

  getBlocks$(from: number): Observable<BlockExtended[]> {
    return this.httpClient.get<BlockExtended[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/blocks` +
        (from !== undefined ? `/${from}` : ``)
    );
  }

  getAsertBlocks$(fromHeight: number): Observable<{ h: number; t: number }[]> {
    return this.httpClient.get<{ h: number; t: number }[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        '/api/v1/mining/blocks/asert/' +
        fromHeight
    );
  }

  getBlock$(hash: string): Observable<BlockExtended> {
    return this.httpClient.get<BlockExtended>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/block/' + hash
    );
  }

  getBlockDataFromTimestamp$(timestamp: number): Observable<any> {
    return this.httpClient.get<number>(
      this.apiBaseUrl +
        this.apiBasePath +
        '/api/v1/mining/blocks/timestamp/' +
        timestamp
    );
  }

  getStrippedBlockTransactions$(
    hash: string
  ): Observable<TransactionStripped[]> {
    this.setBlockSummaryLoaded(hash);
    return this.httpClient.get<TransactionStripped[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/block/' + hash + '/summary'
    );
  }

  getStrippedBlockTransaction$(
    hash: string,
    txid: string
  ): Observable<TransactionStripped> {
    return this.httpClient.get<TransactionStripped>(
      this.apiBaseUrl +
        this.apiBasePath +
        '/api/v1/block/' +
        hash +
        '/tx/' +
        txid +
        '/summary'
    );
  }

  getDifficultyAdjustments$(interval: string | undefined): Observable<any> {
    return this.httpClient.get<any[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/difficulty-adjustments` +
        (interval !== undefined ? `/${interval}` : ''),
      { observe: 'response' }
    );
  }

  getHistoricalHashrate$(interval: string | undefined): Observable<any> {
    return this.httpClient.get<any[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/hashrate` +
        (interval !== undefined ? `/${interval}` : ''),
      { observe: 'response' }
    );
  }

  getHistoricalPoolsHashrate$(interval: string | undefined): Observable<any> {
    return this.httpClient.get<any[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/hashrate/pools` +
        (interval !== undefined ? `/${interval}` : ''),
      { observe: 'response' }
    );
  }

  getHistoricalBlockFees$(interval: string | undefined): Observable<any> {
    return this.httpClient.get<any[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/blocks/fees` +
        (interval !== undefined ? `/${interval}` : ''),
      { observe: 'response' }
    );
  }

  getBlockFeesFromTimespan$(from: number, to: number): Observable<any> {
    return this.httpClient.get<any[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/blocks/fees?from=${from}&to=${to}`,
      { observe: 'response' }
    );
  }

  getHistoricalBlockRewards$(interval: string | undefined): Observable<any> {
    return this.httpClient.get<any[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/blocks/rewards` +
        (interval !== undefined ? `/${interval}` : ''),
      { observe: 'response' }
    );
  }

  getHistoricalBlockFeeRates$(interval: string | undefined): Observable<any> {
    return this.httpClient.get<any[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/blocks/fee-rates` +
        (interval !== undefined ? `/${interval}` : ''),
      { observe: 'response' }
    );
  }

  getHistoricalBlockSizes$(
    interval: string | undefined
  ): Observable<HttpResponse<BlockSizes>> {
    return this.httpClient.get<BlockSizes>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/blocks/sizes` +
        (interval !== undefined ? `/${interval}` : ''),
      { observe: 'response' }
    );
  }

  getHistoricalBlockTimeDiffs$(
    interval: string | undefined
  ): Observable<HttpResponse<BlockTimeDiffs>> {
    return this.httpClient.get<BlockTimeDiffs>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/blocks/timestamps` +
        (interval !== undefined ? `/${interval}` : ''),
      { observe: 'response' }
    );
  }

  getHistoricalBlockTxCounts$(
    interval: string | undefined
  ): Observable<HttpResponse<BlockTxCounts>> {
    return this.httpClient.get<BlockTxCounts>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/blocks/tx-counts` +
        (interval !== undefined ? `/${interval}` : ''),
      { observe: 'response' }
    );
  }

  getHistoricalBlockVolume$(
    interval: string | undefined
  ): Observable<HttpResponse<any>> {
    return this.httpClient.get<any>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/blocks/volume` +
        (interval !== undefined ? `/${interval}` : ''),
      { observe: 'response' }
    );
  }

  getHistoricalUtxoSize$(
    interval: string | undefined
  ): Observable<HttpResponse<UtxoSize>> {
    return this.httpClient.get<UtxoSize>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/blocks/utxo-size` +
        (interval !== undefined ? `/${interval}` : ''),
      { observe: 'response' }
    );
  }

  getHistoricalBlocksHealth$(interval: string | undefined): Observable<any> {
    return this.httpClient.get<any[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/blocks/predictions` +
        (interval !== undefined ? `/${interval}` : ''),
      { observe: 'response' }
    );
  }

  getBlockAudit$(hash: string): Observable<BlockAudit> {
    this.setBlockAuditLoaded(hash);
    return this.httpClient.get<BlockAudit>(
      this.apiBaseUrl + this.apiBasePath + `/api/v1/block/${hash}/audit-summary`
    );
  }

  getBlockTxAudit$(hash: string, txid: string): Observable<TxAuditStatus> {
    return this.httpClient.get<TxAuditStatus>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/block/${hash}/tx/${txid}/audit`
    );
  }

  getBlockAuditScores$(from: number): Observable<AuditScore[]> {
    return this.httpClient.get<AuditScore[]>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/blocks/audit/scores` +
        (from !== undefined ? `/${from}` : ``)
    );
  }

  getBlockAuditScore$(hash: string): Observable<any> {
    return this.httpClient.get<any>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/blocks/audit/score/` +
        hash
    );
  }

  getRewardStats$(blockCount: number = 144): Observable<RewardStats> {
    return this.httpClient.get<RewardStats>(
      this.apiBaseUrl +
        this.apiBasePath +
        `/api/v1/mining/reward-stats/${blockCount}`
    );
  }

  getEnterpriseInfo$(name: string): Observable<any> {
    return this.httpClient.get<any>(
      this.apiBaseUrl + `/api/v1/services/enterprise/info/` + name
    );
  }

  getHistoricalPrice$(
    timestamp: number | undefined,
    currency?: string
  ): Observable<Conversion> {
    if (this.stateService.isAnyTestnet()) {
      return of({
        prices: [],
        exchangeRates: {
          USDEUR: 0,
          USDGBP: 0,
          USDCAD: 0,
          USDCHF: 0,
          USDAUD: 0,
          USDJPY: 0,
          USDBGN: 0,
          USDBRL: 0,
          USDCNY: 0,
          USDCZK: 0,
          USDDKK: 0,
          USDHKD: 0,
          USDHRK: 0,
          USDHUF: 0,
          USDIDR: 0,
          USDILS: 0,
          USDINR: 0,
          USDISK: 0,
          USDKRW: 0,
          USDMXN: 0,
          USDMYR: 0,
          USDNOK: 0,
          USDNZD: 0,
          USDPHP: 0,
          USDPLN: 0,
          USDRON: 0,
          USDRUB: 0,
          USDSEK: 0,
          USDSGD: 0,
          USDTHB: 0,
          USDTRY: 0,
          USDZAR: 0,
        },
      });
    }
    const queryParams = [];

    if (timestamp) {
      queryParams.push(`timestamp=${timestamp}`);
    }

    if (currency) {
      queryParams.push(`currency=${currency}`);
    }
    return this.httpClient.get<Conversion>(
      `${this.apiBaseUrl}${this.apiBasePath}/api/v1/historical-price` +
        (queryParams.length > 0 ? `?${queryParams.join('&')}` : '')
    );
  }

  getTreasuries$(): Observable<Treasury[]> {
    return this.httpClient.get<Treasury[]>(
      this.apiBaseUrl + this.apiBasePath + `/api/v1/treasuries`
    );
  }

  getWallet$(walletName: string): Observable<Record<string, WalletAddress>> {
    return this.httpClient.get<Record<string, WalletAddress>>(
      this.apiBaseUrl + this.apiBasePath + `/api/v1/wallet/${walletName}`
    );
  }

  getPrevouts$(outpoints: { txid: string; vout: number }[]): Observable<any> {
    return this.httpClient.post(
      this.apiBaseUrl + this.apiBasePath + '/api/v1/prevouts',
      outpoints
    );
  }

  // Cache methods
  async setBlockAuditLoaded(hash: string) {
    this.blockAuditLoaded[hash] = true;
  }

  getBlockAuditLoaded(hash) {
    return this.blockAuditLoaded[hash];
  }

  async setBlockSummaryLoaded(hash: string) {
    this.blockSummaryLoaded[hash] = true;
  }

  getBlockSummaryLoaded(hash) {
    return this.blockSummaryLoaded[hash];
  }
}
