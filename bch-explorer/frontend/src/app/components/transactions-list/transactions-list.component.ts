import {
  Component,
  OnInit,
  Input,
  ChangeDetectionStrategy,
  OnChanges,
  Output,
  EventEmitter,
  ChangeDetectorRef,
  OnDestroy,
} from '@angular/core';
import { StateService, SignaturesMode } from '@app/services/state.service';
import { CacheService } from '@app/services/cache.service';
import {
  Observable,
  ReplaySubject,
  BehaviorSubject,
  merge,
  Subscription,
  of,
  forkJoin,
  catchError,
} from 'rxjs';
import {
  Outspend,
  Transaction,
  Vin,
  Vout,
  DetailedOutspend,
} from '@app/interfaces/backend-api.interface';
import { BcmrMetadata } from '../../interfaces/bcmr-api.interface';
import { ElectrsApiService } from '@app/services/backend-api.service';
import { map, tap, switchMap } from 'rxjs/operators';
import { BlockExtended } from '@interfaces/node-api.interface';
import { PriceService } from '@app/services/price.service';
import { StorageService } from '@app/services/storage.service';
import { BcmrService } from '@app/services/bcmr.service';
import {
  ADDRESS_SIMILARITY_THRESHOLD,
  AddressMatch,
  AddressType,
  checkedCompareAddressStrings,
} from '@app/shared/address-utils';
import {
  processInputSignatures,
  Sighash,
  SigInfo,
  SighashLabels,
} from '@app/shared/transaction.utils';
import { ActivatedRoute, Router } from '@angular/router';
import { SighashFlag } from '@app/shared/transaction.utils';

@Component({
  selector: 'app-transactions-list',
  templateUrl: './transactions-list.component.html',
  styleUrls: ['./transactions-list.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionsListComponent implements OnInit, OnChanges, OnDestroy {
  network = '';
  showMoreIncrement = 1000;
  private bcmrMetadataSubject = new BehaviorSubject<Map<string, BcmrMetadata>>(
    new Map()
  ); // key is the category (token id)

  @Input() transactions: Transaction[];
  @Input() cached: boolean = false;
  @Input() showConfirmations = false;
  @Input() transactionPage = false;
  @Input() errorUnblinded = false;
  @Input() paginated = false;
  @Input() inputIndex: number;
  @Input() outputIndex: number;
  @Input() addresses: string[] = [];
  @Input() rowLimit = 12;
  @Input() blockTime: number = 0; // Used for price calculation if all the transactions are in the same block
  @Input() txPreview = false;
  @Input() forceSignaturesMode: SignaturesMode = null;

  @Output() loadMore = new EventEmitter();

  latestBlock$: Observable<BlockExtended>;
  outspendsSubscription: Subscription;
  currencyChangeSubscription: Subscription;
  networkSubscription: Subscription;
  signaturesSubscription: Subscription;
  queryParamsSubscription: Subscription;
  currency: string;
  refreshOutspends$: ReplaySubject<string[]> = new ReplaySubject();
  showDetails$ = new BehaviorSubject<boolean>(false);
  transactionsLength: number = 0;
  inputRowLimit: number = 12;
  outputRowLimit: number = 12;
  showFullScript: { [vinIndex: number]: boolean } = {};
  showFullScriptPubkeyAsm: { [voutIndex: number]: boolean } = {};
  showFullScriptPubkeyHex: { [voutIndex: number]: boolean } = {};
  showFullOpReturnData: { [voutIndex: number]: boolean } = {};
  showFullOpReturnPreview: { [voutIndex: number]: boolean } = {};
  similarityMatches: Map<
    string,
    Map<string, { score: number; match: AddressMatch; group: number }>
  > = new Map();
  showTokenCopied: { [key: string]: boolean } = {};
  outspendRequestPending: boolean = false;
  outspendError: string | null = null;
  pendingOutspendKey: string | null = null;

  selectedSig: { txIndex: number; vindex: number; sig: SigInfo } | null = null;
  sigHighlights: { vin: boolean[]; vout: boolean[] } = { vin: [], vout: [] };
  sighashLabels = SighashLabels;

  signaturesPreference: SignaturesMode = null;
  signaturesOverride: SignaturesMode = null;
  signaturesMode: SignaturesMode = 'interesting';

  bcmrMetadata$ = this.bcmrMetadataSubject.asObservable();

  constructor(
    public stateService: StateService,
    private cacheService: CacheService,
    private electrsApiService: ElectrsApiService,
    private ref: ChangeDetectorRef,
    private priceService: PriceService,
    private storageService: StorageService,
    private route: ActivatedRoute,
    private bcmrService: BcmrService,
    private router: Router
  ) {
    this.signaturesMode =
      this.forceSignaturesMode || this.stateService.signaturesMode$.value;
  }

  ngOnInit(): void {
    this.latestBlock$ = this.stateService.blocks$.pipe(
      map((blocks) => blocks[0])
    );
    this.networkSubscription = this.stateService.networkChanged$.subscribe(
      (network) => {
        this.network = network;
      }
    );

    this.signaturesSubscription = this.stateService.signaturesMode$.subscribe(
      (mode) => {
        this.signaturesPreference = mode;
        this.updateSignaturesMode();
      }
    );

    this.queryParamsSubscription = this.route.queryParams.subscribe(
      (params) => {
        if (
          params['sigs'] &&
          ['all', 'interesting', 'none'].includes(params['sigs'])
        ) {
          this.signaturesOverride = params['sigs'] as SignaturesMode;
          this.updateSignaturesMode();
        } else {
          this.signaturesOverride = null;
          this.updateSignaturesMode();
        }
      }
    );

    this.outspendsSubscription = merge(
      this.refreshOutspends$.pipe(
        switchMap((txIds) => {
          if (!this.cached && !this.txPreview) {
            // break list into batches of 50 (maximum supported by esplora)
            const batches = [];
            for (let i = 0; i < txIds.length; i += 50) {
              batches.push(txIds.slice(i, i + 50));
            }
            return forkJoin(
              batches.map((batch) => {
                return this.electrsApiService.cachedRequest(
                  this.electrsApiService.getOutspendsBatched$,
                  250,
                  batch
                );
              })
            );
          } else {
            return of([]);
          }
        }),
        tap((batchedOutspends: Outspend[][][]) => {
          // flatten batched results back into a single array
          const outspends = batchedOutspends.flat(1);
          if (!this.transactions) {
            return;
          }
          const transactions = this.transactions.filter((tx) => !tx._outspends);
          outspends.forEach((outspend, i) => {
            transactions[i]._outspends = outspend;
          });
          this.ref.markForCheck();
        })
      ),
      this.stateService.utxoSpent$.pipe(
        tap((utxoSpent) => {
          for (const i in utxoSpent) {
            this.transactions[0]._outspends[i] = {
              spent: true,
              txid: utxoSpent[i].txid,
              vin: utxoSpent[i].vin,
            };
          }
        })
      )
    ).subscribe(() => this.ref.markForCheck());

    this.currencyChangeSubscription = this.stateService.fiatCurrency$.subscribe(
      (currency) => {
        this.currency = currency;
        this.refreshPrice();
      }
    );

    // Disable this check in BCH
    // this.updateAddressSimilarities();
  }

  refreshPrice(): void {
    // Loop over all transactions
    if (!this.transactions || !this.transactions.length || !this.currency) {
      return;
    }
    const confirmedTxs = this.transactions.filter(
      (tx) => tx.status.confirmed
    ).length;
    if (!this.blockTime) {
      this.transactions.forEach((tx) => {
        if (!this.blockTime) {
          if (tx.status.block_time) {
            this.priceService
              .getBlockPrice$(
                tx.status.block_time,
                confirmedTxs < 3,
                this.currency
              )
              .pipe(tap((price) => (tx['price'] = price)))
              .subscribe();
          }
        }
      });
    } else {
      this.priceService
        .getBlockPrice$(this.blockTime, true, this.currency)
        .pipe(
          tap((price) =>
            this.transactions?.forEach((tx) => (tx['price'] = price))
          )
        )
        .subscribe();
    }
  }

  ngOnChanges(changes): void {
    if (changes.inputIndex || changes.outputIndex || changes.rowLimit) {
      this.inputRowLimit = Math.max(this.rowLimit, (this.inputIndex || 0) + 3);
      this.outputRowLimit = Math.max(
        this.rowLimit,
        (this.outputIndex || 0) + 3
      );
      if ((this.inputIndex || this.outputIndex) && !changes.transactions) {
        setTimeout(() => {
          const assetBoxElements =
            document.getElementsByClassName('text-start');
          if (assetBoxElements && assetBoxElements[0]) {
            assetBoxElements[0].scrollIntoView({ block: 'center' });
          }
        }, 10);
      }
    }
    if (changes.transactions || changes.addresses) {
      // this.similarityMatches.clear();
      // Disable this check in BCH
      // this.updateAddressSimilarities();
      if (!this.transactions || !this.transactions.length) {
        return;
      }

      this.transactionsLength = this.transactions.length;

      if (!this.txPreview) {
        this.cacheService.setTxCache(this.transactions);
      }

      const confirmedTxs = this.transactions.filter(
        (tx) => tx.status.confirmed
      ).length;

      this.transactions.forEach((tx) => {
        tx['@voutLimit'] = true;
        tx['@vinLimit'] = true;
        tx['_hasCashTokenVin'] = false;
        tx['_hasCashTokenVout'] = false;
        tx['_showSignatures'] = false;
        tx['_interestingSignatures'] = false;

        if (this.addresses?.length) {
          const addressIn = tx.vout
            .map((v) => {
              for (const address of this.addresses) {
                switch (address.length) {
                  case 130:
                    {
                      if (v.scriptpubkey === '41' + address + 'ac') {
                        return v.value;
                      }
                    }
                    break;
                  case 66:
                    {
                      if (v.scriptpubkey === '21' + address + 'ac') {
                        return v.value;
                      }
                    }
                    break;
                  default:
                    {
                      if (v.scriptpubkey_address === address) {
                        return v.value;
                      }
                    }
                    break;
                }
              }
              return 0;
            })
            .reduce((acc, v) => acc + v, 0);
          const addressOut = tx.vin
            .map((v) => {
              for (const address of this.addresses) {
                switch (address.length) {
                  case 130:
                    {
                      if (v.prevout?.scriptpubkey === '41' + address + 'ac') {
                        return v.prevout?.value;
                      }
                    }
                    break;
                  case 66:
                    {
                      if (v.prevout?.scriptpubkey === '21' + address + 'ac') {
                        return v.prevout?.value;
                      }
                    }
                    break;
                  default:
                    {
                      if (v.prevout?.scriptpubkey_address === address) {
                        return v.prevout?.value;
                      }
                    }
                    break;
                }
              }
              return 0;
            })
            .reduce((acc, v) => acc + v, 0);
          tx['addressValue'] = addressIn - addressOut;
        }

        if (!this.blockTime && tx.status.block_time && this.currency) {
          this.priceService
            .getBlockPrice$(
              tx.status.block_time,
              confirmedTxs < 3,
              this.currency
            )
            .pipe(tap((price) => (tx['price'] = price)))
            .subscribe();
        }

        // process signature data
        if (tx.vin.length && !tx.vin[0].is_coinbase) {
          tx['_sigs'] = tx.vin.map((vin) => processInputSignatures(vin));
          tx['_sigmap'] = tx['_sigs'].reduce((map, sigs, vindex) => {
            sigs.forEach((sig) => {
              map[sig.signature] = { sig, vindex };
            });
            return map;
          }, {});

          if (!tx['_interestingSignatures']) {
            tx['_interestingSignatures'] =
              tx['_sigs'].some((sigs) =>
                sigs.some((sig) => this.sigIsInteresting(sig))
              ) || tx['_sigs'].every((sigs) => !sigs?.length);
          }
        }
        tx['_showSignatures'] = this.shouldShowSignatures(tx);
        tx['_hasCashTokenVin'] = tx.vin.some((vin) => vin?.token_category);
        tx['_hasCashTokenVout'] = tx.vout.some((vout) => vout?.token_category);

        tx.largeInput =
          tx.largeInput ||
          tx.vin.some((vin) => vin?.prevout?.value > 1000000000);
        tx.largeOutput = tx.vout.some((vout) => vout?.value > 1000000000);
      });

      if (this.blockTime && this.transactions?.length && this.currency) {
        this.priceService
          .getBlockPrice$(this.blockTime, true, this.currency)
          .pipe(
            tap((price) =>
              this.transactions?.forEach((tx) => (tx['price'] = price))
            )
          )
          .subscribe();
      }
      const txIds = this.transactions
        .filter((tx) => !tx._outspends)
        .map((tx) => tx.txid);
      if (txIds.length && !this.cached) {
        this.refreshOutspends$.next(txIds);
      }
    }

    this.retrieveBcmrMetadata();
  }

  updateAddressSimilarities(): void {
    if (!this.transactions || !this.transactions.length) {
      return;
    }
    for (const tx of this.transactions) {
      if (this.similarityMatches.get(tx.txid)) {
        continue;
      }

      const similarityGroups: Map<string, number> = new Map();
      let lastGroup = 0;

      // Check for address poisoning similarity matches
      this.similarityMatches.set(tx.txid, new Map());
      const comparableVouts = tx.vout
        .slice(0, 20)
        .filter(
          (v) =>
            ['p2pkh', 'p2sh'].includes(v.scriptpubkey_type) &&
            !this.isFakeScripthash(v)
        );
      const comparableVins = tx.vin
        .slice(0, 20)
        .map((v) => v.prevout)
        .filter(
          (v) =>
            ['p2pkh', 'p2sh'].includes(v?.scriptpubkey_type) &&
            !this.isFakeScripthash(v)
        );

      // Count unique addresses per type & position
      const typeCount = new Map<
        string,
        { voutAddrs: Set<string>; vinAddrs: Set<string> }
      >();
      for (const vout of comparableVouts) {
        const count = typeCount.get(vout.scriptpubkey_type) || {
          voutAddrs: new Set(),
          vinAddrs: new Set(),
        };
        count.voutAddrs.add(vout.scriptpubkey_address);
        typeCount.set(vout.scriptpubkey_type, count);
      }
      for (const vin of comparableVins) {
        const count = typeCount.get(vin.scriptpubkey_type!) || {
          voutAddrs: new Set(),
          vinAddrs: new Set(),
        };
        count.vinAddrs.add(vin.scriptpubkey_address);
        typeCount.set(vin.scriptpubkey_type!, count);
      }
      // We compare each vout to every distinct vin and every other vout address of the same type
      let totalUniquePairs = 0;
      for (const { voutAddrs, vinAddrs } of typeCount.values()) {
        const V = voutAddrs.size;
        const I = vinAddrs.size;
        totalUniquePairs += (V * (V - 1)) / 2 + V * I;
      }
      // Adjust threshold to correct for the birthday paradox
      const adjustedThreshold =
        totalUniquePairs > 0
          ? ADDRESS_SIMILARITY_THRESHOLD * totalUniquePairs
          : ADDRESS_SIMILARITY_THRESHOLD;

      for (const vout of comparableVouts) {
        const address = vout.scriptpubkey_address;
        const addressType = vout.scriptpubkey_type;
        if (this.similarityMatches.get(tx.txid)?.has(address)) {
          continue;
        }
        for (const compareAddr of [
          ...comparableVouts.filter(
            (v) =>
              v.scriptpubkey_type === addressType &&
              v.scriptpubkey_address !== address
          ),
          ...comparableVins.filter(
            (v) =>
              v.scriptpubkey_type === addressType &&
              v.scriptpubkey_address !== address
          ),
        ]) {
          const similarity = checkedCompareAddressStrings(
            address,
            compareAddr.scriptpubkey_address,
            addressType as AddressType,
            this.stateService.network
          );
          if (
            similarity?.status === 'comparable' &&
            similarity.score > adjustedThreshold
          ) {
            // Get or create group numbers for both addresses
            const group1 = similarityGroups.get(address);
            const group2 = similarityGroups.get(
              compareAddr.scriptpubkey_address
            );

            let group: number;
            if (group1 !== undefined && group2 !== undefined) {
              // Both have groups - merge by using the lower group number
              group = Math.min(group1, group2);
              // Update all addresses with the higher group number to use the lower one
              if (group1 !== group2) {
                const higherGroup = Math.max(group1, group2);
                for (const [addr, g] of similarityGroups.entries()) {
                  if (g === higherGroup) {
                    similarityGroups.set(addr, group);
                  }
                }
              }
            } else if (group1 !== undefined) {
              // Only first address has a group
              group = group1;
            } else if (group2 !== undefined) {
              // Only second address has a group
              group = group2;
            } else {
              // Neither has a group - create a new one
              group = lastGroup++;
            }

            // Assign the group to both addresses
            similarityGroups.set(address, group);
            similarityGroups.set(compareAddr.scriptpubkey_address, group);

            const bestVout = this.similarityMatches.get(tx.txid)?.get(address);
            if (!bestVout || bestVout.score < similarity.score) {
              this.similarityMatches.get(tx.txid)?.set(address, {
                score: similarity.score,
                match: similarity.left,
                group,
              });
            }
            // opportunistically update the entry for the compared address
            const bestCompare = this.similarityMatches
              .get(tx.txid)
              ?.get(compareAddr.scriptpubkey_address);
            if (!bestCompare || bestCompare.score < similarity.score) {
              this.similarityMatches
                .get(tx.txid)
                ?.set(compareAddr.scriptpubkey_address, {
                  score: similarity.score,
                  match: similarity.right,
                  group,
                });
            }
          }
        }
      }
    }
  }

  /**
   * Retrieves BCMR metadata for the given transaction or all transactions in the list.
   * @param tx The transaction to retrieve BCMR metadata for. If not provided, all transactions (with a limit) in the list will be used.
   */
  retrieveBcmrMetadata(tx?: Transaction): void {
    let transactions = this.transactions;
    if (tx) {
      transactions = [tx];
    }
    const map = new Map(this.bcmrMetadataSubject.value);
    const uniqueCategories = new Set<string>();
    transactions.forEach((tx) => {
      // loop over the tx.vin until we hit the current limit of getVinLimit(tx)
      tx.vin.slice(0, this.getVinLimit(tx)).forEach((vin) => {
        if (vin?.token_category) {
          uniqueCategories.add(vin.token_category);
        }
      });
      // loop ove the tx.vout until we hit the current limit of getVoutLimit(tx)
      tx.vout.slice(0, this.getVoutLimit(tx)).forEach((vout) => {
        if (vout?.token_category) {
          uniqueCategories.add(vout.token_category);
        }
      });
    });
    // Only retrieve unique categories
    const observables: Array<{
      category: string;
      metadata$: Observable<BcmrMetadata>;
    }> = [];
    uniqueCategories.forEach((category) => {
      // If the category is already in the cache, skip the HTTP call
      if (map.has(category)) {
        return;
      }
      // Create a list of observables to retrieve the metadata for each category
      observables.push({
        category, // For later reference
        metadata$: this.bcmrService.getBcmrMetadata(category).pipe(
          catchError((error) => {
            // console.info(
            //   `Failed to fetch BCMR metadata for category ${category}: ${error.message}.`
            // );
            // Return null or a default value when the request fails
            return of(null as BcmrMetadata | null);
          })
        ),
      });
    });

    if (observables.length > 0) {
      // Wait for all HTTP requests to complete
      forkJoin(observables.map((obs) => obs.metadata$)).subscribe((results) => {
        results.forEach((metadata, index) => {
          const category = observables[index].category;
          // Only set the metadata if it's not null (i.e., request was successful)
          if (metadata !== null) {
            map.set(category, metadata);
          }
        });
        // Emit the new map to the subject only after all requests are done
        this.bcmrMetadataSubject.next(map);
      });
    } else {
      // No new categories to fetch, emit the current map
      this.bcmrMetadataSubject.next(map);
    }
  }

  formatTokenAmount(amount: string, decimals?: number): string {
    if (amount == null) return '';
    if (typeof decimals === 'undefined' || decimals == null || decimals < 0)
      return ''; // That sounds like invalid data, return empty string
    if (decimals === 0) {
      // Decimal is zero, add commas to the amount
      return amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    if (amount === '0') {
      return ''; // Don't show if its zero
    }

    // Ensure string length >= decimals
    const padded = amount.padStart(decimals + 1, '0');

    const integerPart = padded.slice(0, -decimals);
    const fractionalPart = padded.slice(-decimals);

    // Add commas to integer part
    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return `${formattedInteger}.${fractionalPart}`;
  }

  // assume any address with 12 or more contiguous repeated substrings is fake
  fakeScriptHashRegex = new RegExp(/(.+?)\1{11,}/);
  isFakeScripthash(vout: Vout): boolean {
    return this.fakeScriptHashRegex.test(vout.scriptpubkey_address);
  }

  onScroll(): void {
    this.loadMore.emit();
  }

  haveBlindedOutputValues(tx: Transaction): boolean {
    return tx.vout.some((v: any) => v.value === undefined);
  }

  getTotalTxInput(tx: Transaction): number {
    return tx.vin
      .map((v: Vin) => v.prevout?.value ?? v.value ?? 0)
      .reduce((a: number, b: number) => a + b);
  }

  getTotalTxOutput(tx: Transaction): number {
    return tx.vout
      .map((v: Vout) => v.value || 0)
      .reduce((a: number, b: number) => a + b);
  }

  switchCurrency(): void {
    const modes = ['bch', 'sats', 'fiat'];
    const oldIndex = modes.indexOf(this.stateService.viewAmountMode$.value);
    const newIndex = (oldIndex + 1) % modes.length;
    this.stateService.viewAmountMode$.next(
      modes[newIndex] as 'bch' | 'sats' | 'fiat'
    );
    this.storageService.setValue('view-amount-mode', modes[newIndex]);
  }

  trackByFn(index: number, tx: Transaction): string {
    return tx.txid + tx.status.confirmed;
  }

  trackByIndexFn(index: number): number {
    return index;
  }

  formatHex(num: number): string {
    const str = num.toString(16);
    return '0x' + (str.length % 2 ? '0' : '') + str;
  }

  pow(base: number, exponent: number): number {
    return Math.pow(base, exponent);
  }

  toggleDetails(): void {
    if (this.showDetails$.value === true) {
      this.showDetails$.next(false);
      this.showFullScript = {};
    } else {
      this.showFullScript = this.transactions[0]
        ? this.transactions[0].vin.reduce(
            (acc, _, i) => ({ ...acc, [i]: false }),
            {}
          )
        : {};
      this.showDetails$.next(true);
    }
  }

  loadMoreInputs(tx: Transaction): void {
    if (!tx['@vinLoaded'] && !this.txPreview) {
      this.electrsApiService.getTransaction$(tx.txid).subscribe((newTx) => {
        tx['@vinLoaded'] = true;
        tx.vin = newTx.vin;
        tx.fee = newTx.fee;
        this.ref.markForCheck();
      });
    }
  }

  showMoreInputs(tx: Transaction): void {
    this.loadMoreInputs(tx);
    tx['@vinLimit'] = this.getVinLimit(tx, true);
    this.retrieveBcmrMetadata(tx);
  }

  showMoreOutputs(tx: Transaction): void {
    tx['@voutLimit'] = this.getVoutLimit(tx, true);
    this.retrieveBcmrMetadata(tx);
  }

  hasVinCashToken(tx: Transaction): boolean {
    return tx.vin.some((v: Vin) => v.token_category);
  }

  hasVoutCashToken(tx: Transaction): boolean {
    return tx.vout.some((v: Vout) => v.token_category);
  }

  getVinLimit(tx: Transaction, next = false): number {
    let limit;
    if ((tx['@vinLimit'] || 0) > this.inputRowLimit) {
      limit = Math.min(
        tx['@vinLimit'] + (next ? this.showMoreIncrement : 0),
        tx.vin.length
      );
    } else {
      limit = Math.min(
        next ? this.showMoreIncrement : this.inputRowLimit,
        tx.vin.length
      );
    }
    // Don't apply auto-show-all if there are lazy inputs (need explicit loading)
    const hasLazyInputs = tx.vin.some((vin) => vin.lazy);
    if (!hasLazyInputs && tx.vin.length - limit <= 5) {
      limit = tx.vin.length;
    }
    return limit;
  }

  getVoutLimit(tx: Transaction, next = false): number {
    let limit;
    if ((tx['@voutLimit'] || 0) > this.outputRowLimit) {
      limit = Math.min(
        tx['@voutLimit'] + (next ? this.showMoreIncrement : 0),
        tx.vout.length
      );
    } else {
      limit = Math.min(
        next ? this.showMoreIncrement : this.outputRowLimit,
        tx.vout.length
      );
    }
    if (tx.vout.length - limit <= 5) {
      limit = tx.vout.length;
    }
    return limit;
  }

  toggleShowFullScript(vinIndex: number): void {
    this.showFullScript[vinIndex] = !this.showFullScript[vinIndex];
  }

  toggleShowFullScriptPubkeyAsm(voutIndex: number): void {
    this.showFullScriptPubkeyAsm[voutIndex] =
      !this.showFullScriptPubkeyAsm[voutIndex];
  }

  toggleShowFullScriptPubkeyHex(voutIndex: number): void {
    this.showFullScriptPubkeyHex[voutIndex] =
      !this.showFullScriptPubkeyHex[voutIndex];
  }

  toggleShowFullOpReturnData(voutIndex: number): void {
    this.showFullOpReturnData[voutIndex] =
      !this.showFullOpReturnData[voutIndex];
  }

  toggleShowFullOpReturnPreview(voutIndex: number): void {
    this.showFullOpReturnPreview[voutIndex] =
      !this.showFullOpReturnPreview[voutIndex];
  }

  showSigInfo(txIndex: number, vindex: number, sig: SigInfo): void {
    this.selectedSig = { txIndex, vindex, sig };
    this.sigHighlights = { vin: [], vout: [] };
    for (let i = 0; i < this.transactions[txIndex].vin.length; i++) {
      this.sigHighlights.vin.push(i === vindex || !Sighash.isACP(sig.sighash));
    }
    for (let i = 0; i < this.transactions[txIndex].vout.length; i++) {
      this.sigHighlights.vout.push(
        !Sighash.isNone(sig.sighash) &&
          (!Sighash.isSingle(sig.sighash) || i === vindex)
      );
    }
    this.ref.markForCheck();
  }

  hideSigInfo(): void {
    this.selectedSig = null;
    this.sigHighlights = { vin: [], vout: [] };
    this.ref.markForCheck();
  }

  updateSignaturesMode(): void {
    this.signaturesMode =
      this.signaturesOverride ||
      this.forceSignaturesMode ||
      this.signaturesPreference ||
      'interesting';
    if (this.transactions?.length) {
      for (const tx of this.transactions) {
        tx['_showSignatures'] = this.shouldShowSignatures(tx);
      }
    }
  }

  showSig(sigs: SigInfo[]): boolean {
    return (
      this.signaturesMode === 'all' ||
      (this.signaturesMode === 'interesting' &&
        sigs.some((sig) => this.sigIsInteresting(sig)))
    );
  }

  sigIsInteresting(sig: SigInfo): boolean {
    return sig.sighash !== (SighashFlag.ALL | SighashFlag.FORKID);
  }

  shouldShowSignatures(tx): boolean {
    switch (this.signaturesMode) {
      case 'all':
        return true;
      case 'interesting':
        return tx['_interestingSignatures'];
      default:
        return false;
    }
  }

  copyTokenId(
    tokenId: string,
    txIndex: number,
    type: 'vin' | 'vout',
    index: number
  ): void {
    const key = `${txIndex}-${type}-${index}`;
    if (this.showTokenCopied[key]) return;
    navigator.clipboard.writeText(tokenId).then(() => {
      this.showTokenCopied[key] = true;
      this.ref.markForCheck();
      setTimeout(() => {
        this.showTokenCopied[key] = false;
        this.ref.markForCheck();
      }, 1000);
    });
  }

  ngOnDestroy(): void {
    this.outspendsSubscription.unsubscribe();
    this.currencyChangeSubscription?.unsubscribe();
    this.networkSubscription.unsubscribe();
    this.signaturesSubscription.unsubscribe();
  }

  onOutspendClick(tx: Transaction, vindex: number): void {
    const key = `${tx.txid}-${vindex}`;

    // Prevent multiple simultaneous requests
    if (this.outspendRequestPending) {
      return;
    }

    this.outspendRequestPending = true;
    this.pendingOutspendKey = key;
    this.outspendError = null;
    this.ref.markForCheck();

    this.electrsApiService.getOutspend$(tx.txid, vindex).subscribe({
      next: (detailedOutspend: DetailedOutspend) => {
        this.outspendRequestPending = false;

        if (detailedOutspend.spent && detailedOutspend.txid) {
          this.pendingOutspendKey = null;
          this.router.navigate(['/tx', detailedOutspend.txid], {
            fragment: `flow=&vin=${detailedOutspend.vin}`,
            queryParams: { showFlow: true },
          });
        } else if (detailedOutspend.spent && !detailedOutspend.txid) {
          // Spent but txid not found
          this.pendingOutspendKey = key;
          this.outspendError = 'Spending transaction not found';
        } else {
          // Not spent !?
          this.pendingOutspendKey = null;
        }
        this.ref.markForCheck();
      },
      error: (error) => {
        this.outspendRequestPending = false;
        this.pendingOutspendKey = key;
        this.outspendError = 'Failed to load outspend details';
        this.ref.markForCheck();
      },
    });
  }

  isOutspendPending(txid: string, vindex: number): boolean {
    return (
      this.outspendRequestPending &&
      this.pendingOutspendKey === `${txid}-${vindex}`
    );
  }

  hasOutspendError(txid: string, vindex: number): boolean {
    return (
      this.outspendError !== null &&
      this.pendingOutspendKey === `${txid}-${vindex}`
    );
  }

  clearOutspendError(): void {
    this.outspendError = null;
    this.pendingOutspendKey = null;
    this.ref.markForCheck();
  }
}
