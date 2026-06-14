import {
  Component,
  OnInit,
  HostListener,
  ViewChild,
  ElementRef,
  OnDestroy,
} from '@angular/core';
import { BytesPipe } from '@app/shared/pipes/bytes-pipe/bytes.pipe';
import { Transaction, Vout } from '@app/interfaces/backend-api.interface';
import { StateService } from '@app/services/state.service';
import { Filter, toFilters } from '@app/shared/filters.utils';
import {
  decodeRawTransaction,
  getTransactionFlags,
  addInnerScriptsToVin,
  countSigops,
  fillUnsignedInput,
} from '@app/shared/transaction.utils';
import {
  catchError,
  firstValueFrom,
  Subscription,
  switchMap,
  tap,
  throwError,
  timer,
} from 'rxjs';
import { WebsocketService } from '@app/services/websocket.service';
import { ActivatedRoute, Router } from '@angular/router';
import {
  UntypedFormBuilder,
  UntypedFormGroup,
  Validators,
} from '@angular/forms';
import { ElectrsApiService } from '@app/services/backend-api.service';
import { SeoService } from '@app/services/seo.service';
import { seoDescriptionNetwork } from '@app/shared/common.utils';
import { ApiService } from '@app/services/api.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

@Component({
  selector: 'app-transaction-raw',
  templateUrl: './transaction-raw.component.html',
  styleUrls: ['./transaction-raw.component.scss'],
  standalone: false,
})
export class TransactionRawComponent implements OnInit, OnDestroy {
  pushTxForm: UntypedFormGroup;
  rawHexTransaction: string;
  psbt: string;
  isLoading: boolean;
  isLoadingPrevouts: boolean;
  offlineMode: boolean = false;
  transaction: Transaction;
  error: string;
  errorPrevouts: string;
  hasPrevouts: boolean;
  missingPrevouts: string[];
  isLoadingBroadcast: boolean;
  errorBroadcast: string;
  successBroadcast: boolean;
  isCoinbase: boolean;
  broadcastSubscription: Subscription;
  fragmentSubscription: Subscription;
  sizeFromMissingSig: number = 0;
  missingSignatures: boolean;
  warnings: string[] = [];
  tooltipSize: string;

  isMobile: boolean;
  @ViewChild('graphContainer')
  graphContainer: ElementRef;
  graphExpanded: boolean = false;
  graphWidth: number = 1068;
  graphHeight: number = 360;
  inOutLimit: number = 150;
  maxInOut: number = 0;
  flowPrefSubscription: Subscription;
  hideFlow: boolean;
  flowEnabled: boolean;
  filters: Filter[] = [];
  mempoolBlocksSubscription: Subscription;

  constructor(
    public route: ActivatedRoute,
    public router: Router,
    public stateService: StateService,
    public electrsApi: ElectrsApiService,
    public websocketService: WebsocketService,
    public formBuilder: UntypedFormBuilder,
    public seoService: SeoService,
    public apiService: ApiService,
    public relativeUrlPipe: RelativeUrlPipe,
    public bytesPipe: BytesPipe
  ) {}

  ngOnInit(): void {
    this.hideFlow = this.stateService.hideFlow.value;

    this.seoService.setTitle(
      $localize`:@@d7f92e6fe26fba6fff568cbdae5db4a5c8c6a55c:Preview Transaction`
    );
    this.seoService.setDescription(
      $localize`:@@meta.description.preview-tx:Preview a transaction to the Bitcoin${seoDescriptionNetwork(this.stateService.network)} network using the transaction's raw hex data.`
    );
    this.websocketService.want(['blocks', 'mempool-blocks']);
    this.pushTxForm = this.formBuilder.group({
      txRaw: ['', Validators.required],
    });

    this.fragmentSubscription = this.route.fragment.subscribe((fragment) => {
      if (fragment) {
        const params = new URLSearchParams(fragment);
        const txData = params.get('tx');
        if (txData) {
          this.pushTxForm.get('txRaw').setValue(txData);
        }
        const offline = params.get('offline');
        if (offline) {
          this.offlineMode = offline === 'true';
        }
        if (txData && this.pushTxForm.get('txRaw').value && !this.transaction) {
          this.decodeTransaction();
        }
      }
    });
  }

  async decodeTransaction(): Promise<void> {
    this.resetState();
    this.isLoading = true;
    try {
      const { tx, hex, psbt, warnings } = decodeRawTransaction(
        this.pushTxForm.get('txRaw').value.trim(),
        this.stateService.network
      );
      this.warnings = warnings || [];
      await this.fetchPrevouts(tx);
      this.checkSignatures(tx, hex);
      this.processTransaction(tx, hex, psbt);
    } catch (error) {
      this.error = error.message;
    } finally {
      this.isLoading = false;
    }
  }

  async fetchPrevouts(transaction: Transaction): Promise<void> {
    const prevoutsToFetch = transaction.vin
      .filter((input) => !input.prevout || input.prevout.value === null)
      .map((input) => ({ txid: input.txid, vout: input.vout }));

    if (
      !prevoutsToFetch.length ||
      transaction.vin[0].is_coinbase ||
      this.offlineMode
    ) {
      this.hasPrevouts =
        !prevoutsToFetch.length || transaction.vin[0].is_coinbase;
    } else {
      try {
        this.missingPrevouts = [];
        this.isLoadingPrevouts = true;

        const prevouts: ({ prevout: Vout; unconfirmed: boolean } | null)[] =
          await firstValueFrom(this.apiService.getPrevouts$(prevoutsToFetch));

        let fetchIndex = 0;
        transaction.vin.forEach((input) => {
          if (!input.prevout || input.prevout.value === null) {
            const fetched = prevouts?.[fetchIndex] ?? null;
            if (fetched) {
              const derivedAddress = input.prevout?.scriptpubkey_address;
              input.prevout = fetched.prevout;
              if (!input.prevout.scriptpubkey_address && derivedAddress) {
                input.prevout.scriptpubkey_address = derivedAddress;
              }
              // Promote token fields from prevout to vin so display templates
              // (which read vin.token_category directly) can render them
              if (input.prevout.token_category) {
                input.token_category = input.prevout.token_category;
                input.token_amount = input.prevout.token_amount;
                input.token_nft_capability = input.prevout.token_nft_capability;
                input.token_nft_commitment = input.prevout.token_nft_commitment;
              }
            } else if (!input.prevout) {
              this.missingPrevouts.push(`${input.txid}:${input.vout}`);
            }
            // else: keep derived address prevout (value: null) as display fallback
            fetchIndex++;
          }
        });

        const allValuesPresent = transaction.vin.every(
          (input) =>
            input.is_coinbase ||
            (input.prevout?.value !== null &&
              input.prevout?.value !== undefined)
        );

        if (this.missingPrevouts.length && !allValuesPresent) {
          throw new Error(
            `Some prevouts do not exist or are already spent (${this.missingPrevouts.length})`
          );
        }

        this.hasPrevouts = allValuesPresent;
        this.isLoadingPrevouts = false;
      } catch (error) {
        console.log(error);
        this.errorPrevouts = error?.error?.error || error?.message;
        this.isLoadingPrevouts = false;
      }
    }
  }

  checkSignatures(transaction: Transaction, hex: string): void {
    let missingBytes = 0;

    transaction.vin.forEach((vin) => {
      addInnerScriptsToVin(vin);
      const result = fillUnsignedInput(vin);
      vin['_missingSigs'] = result.missingSigs;
      missingBytes += result.bytes;
    });

    this.sizeFromMissingSig = missingBytes;

    if (this.sizeFromMissingSig) {
      this.tooltipSize = `Includes ${this.bytesPipe.transform(this.sizeFromMissingSig, 2, undefined, undefined, true)} added for missing signatures`;
    }

    this.missingSignatures = transaction.vin.some(
      (input) => input['_missingSigs'] > 0
    );

    if (this.hasPrevouts) {
      transaction.fee = transaction.vin.some((input) => input.is_coinbase)
        ? 0
        : transaction.vin.reduce((fee, input) => {
            return fee + (input.prevout?.value || 0);
          }, 0) -
          transaction.vout.reduce((sum, output) => sum + output.value, 0);
      transaction.feePerSize =
        transaction.fee / ((transaction.size + this.sizeFromMissingSig) / 4);
      transaction.sigops = countSigops(transaction);
    }
  }

  processTransaction(tx: Transaction, hex: string, psbt: string): void {
    this.transaction = tx;
    this.rawHexTransaction = hex;
    this.psbt = psbt;

    this.isCoinbase = this.transaction.vin[0].is_coinbase;

    // Update URL fragment with hex or psbt data
    this.router.navigate([], {
      fragment: this.getCurrentFragments(),
      replaceUrl: true,
    });

    const txHeight =
      this.transaction.status?.block_height ||
      (this.stateService.latestBlockHeight >= 0
        ? this.stateService.latestBlockHeight + 1
        : null);
    this.transaction.flags = getTransactionFlags(
      this.transaction,
      txHeight,
      this.stateService.network
    );
    this.filters = this.transaction.flags
      ? toFilters(this.transaction.flags).filter((f) => f.txPage)
      : [];

    this.setupGraph();
    this.setFlowEnabled();
    this.flowPrefSubscription = this.stateService.hideFlow.subscribe((hide) => {
      this.hideFlow = !!hide;
      this.setFlowEnabled();
    });
    this.setGraphSize();

    this.mempoolBlocksSubscription = this.stateService.mempoolBlocks$.subscribe(
      () => {
        if (this.transaction) {
          this.stateService.markBlock$.next({
            txid: this.transaction.txid,
            txFeePerSize: this.transaction.feePerSize,
          });
        }
      }
    );
  }

  postTx(): void {
    this.isLoadingBroadcast = true;
    this.errorBroadcast = null;

    this.broadcastSubscription = this.apiService
      .postTransaction$(this.rawHexTransaction)
      .pipe(
        tap((txid: string) => {
          this.isLoadingBroadcast = false;
          this.successBroadcast = true;
          this.transaction.txid = txid;
        }),
        switchMap((txid: string) =>
          timer(2000).pipe(
            tap(() =>
              this.router.navigate([
                this.relativeUrlPipe.transform('/tx/' + txid),
              ])
            )
          )
        ),
        catchError((error) => {
          if (typeof error.error === 'string') {
            const matchText = error.error
              .replace(/\\/g, '')
              .match('"message":"(.*?)"');
            this.errorBroadcast =
              'Failed to broadcast transaction, reason: ' +
              ((matchText && matchText[1]) || error.error);
          } else if (error.message) {
            this.errorBroadcast =
              'Failed to broadcast transaction, reason: ' + error.message;
          }
          this.isLoadingBroadcast = false;
          return throwError(() => error);
        })
      )
      .subscribe();
  }

  resetState() {
    this.transaction = null;
    this.rawHexTransaction = null;
    this.psbt = null;
    this.error = null;
    this.errorPrevouts = null;
    this.errorBroadcast = null;
    this.successBroadcast = false;
    this.isLoading = false;
    this.isLoadingPrevouts = false;
    this.isLoadingBroadcast = false;
    this.filters = [];
    this.hasPrevouts = false;
    this.missingPrevouts = [];
    this.sizeFromMissingSig = 0;
    this.missingSignatures = false;
    this.warnings = [];
    this.tooltipSize = null;
    this.stateService.markBlock$.next({});
    this.mempoolBlocksSubscription?.unsubscribe();
    this.broadcastSubscription?.unsubscribe();
  }

  resetForm() {
    this.resetState();
    this.pushTxForm.get('txRaw').setValue('');
    this.offlineMode = false;
    this.router.navigate([], {
      fragment: '',
      replaceUrl: true,
    });
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
    } else {
      setTimeout(() => {
        this.setGraphSize();
      }, 1);
    }
  }

  setupGraph() {
    this.maxInOut = Math.min(
      this.inOutLimit,
      Math.max(
        this.transaction?.vin?.length || 1,
        this.transaction?.vout?.length + 1 || 1
      )
    );
    this.graphHeight = this.graphExpanded
      ? this.maxInOut * 15
      : Math.min(360, this.maxInOut * 80);
  }

  toggleGraph() {
    const showFlow = !this.flowEnabled;
    this.stateService.hideFlow.next(!showFlow);
  }

  setFlowEnabled() {
    this.flowEnabled = !this.hideFlow;
  }

  expandGraph() {
    this.graphExpanded = true;
    this.graphHeight = this.maxInOut * 15;
  }

  collapseGraph() {
    this.graphExpanded = false;
    this.graphHeight = Math.min(360, this.maxInOut * 80);
  }

  getCurrentFragments() {
    // build a fragment param string from current state
    const params = new URLSearchParams();
    if (this.offlineMode) {
      params.set('offline', 'true');
    }
    if (this.rawHexTransaction) {
      params.set('tx', this.psbt || this.rawHexTransaction); // use PSBT in fragment if available
    }
    return params.toString();
  }

  onOfflineModeChange(e): void {
    this.offlineMode = !e.target.checked;
    this.router.navigate([], {
      fragment: this.getCurrentFragments(),
      replaceUrl: true,
    });
  }

  ngOnDestroy(): void {
    this.mempoolBlocksSubscription?.unsubscribe();
    this.flowPrefSubscription?.unsubscribe();
    this.stateService.markBlock$.next({});
    this.broadcastSubscription?.unsubscribe();
    this.fragmentSubscription?.unsubscribe();
  }
}
