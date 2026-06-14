import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';
import {
  detectAddressType,
  legacyToCashAddr,
  cashAddrToLegacy,
  convertToTokenAddress,
  isTokenAddress,
  tokenToCashAddr,
} from '@app/shared/address-utils';

@Component({
  selector: 'app-address-converter',
  templateUrl: './address-converter.component.html',
  styleUrls: ['./address-converter.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddressConverterComponent implements OnInit, OnDestroy {
  form: FormGroup;
  cashAddr: string | null = null;
  legacyAddr: string | null = null;
  tokenAddr: string | null = null;
  activeTab: 'cashaddr' | 'legacy' | 'token' = 'cashaddr';
  error: string | null = null;

  get activeAddr(): string | null {
    if (this.activeTab === 'cashaddr') return this.cashAddr;
    if (this.activeTab === 'legacy') return this.legacyAddr;
    return this.tokenAddr;
  }

  private destroy$ = new Subject<void>();

  constructor(
    private formBuilder: FormBuilder,
    private stateService: StateService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.form = this.formBuilder.group({ address: [''] });

    this.form
      .get('address')
      .valueChanges.pipe(debounceTime(200), takeUntil(this.destroy$))
      .subscribe(() => this.convert());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setTab(tab: 'cashaddr' | 'legacy' | 'token'): void {
    this.activeTab = tab;
    this.cd.markForCheck();
  }

  convert(): void {
    const raw: string = (this.form.get('address').value || '').trim();
    if (!raw) {
      this.cashAddr = null;
      this.legacyAddr = null;
      this.tokenAddr = null;
      this.error = null;
      this.cd.markForCheck();
      return;
    }

    const network = this.stateService.network || 'mainnet';
    const type = detectAddressType(raw, network);

    try {
      if (type === 'p2pkh' || type === 'p2sh') {
        const isLegacy =
          !raw.includes(':') &&
          (raw.startsWith('1') ||
            raw.startsWith('3') ||
            raw.startsWith('m') ||
            raw.startsWith('n') ||
            raw.startsWith('2'));
        const isToken = !isLegacy && isTokenAddress(raw);

        if (isLegacy) {
          this.legacyAddr = raw;
          this.cashAddr = legacyToCashAddr(raw, network);
          this.tokenAddr = convertToTokenAddress(this.cashAddr);
          this.activeTab = 'cashaddr';
        } else if (isToken) {
          this.tokenAddr = raw.includes(':') ? raw : `bitcoincash:${raw}`;
          this.cashAddr = tokenToCashAddr(raw);
          this.legacyAddr = cashAddrToLegacy(this.cashAddr, network);
          this.activeTab = 'cashaddr';
        } else {
          this.cashAddr = raw.includes(':') ? raw : `bitcoincash:${raw}`;
          this.legacyAddr = cashAddrToLegacy(raw, network);
          this.tokenAddr = convertToTokenAddress(this.cashAddr);
          this.activeTab = 'legacy';
        }
        this.error = null;
      } else {
        this.cashAddr = null;
        this.legacyAddr = null;
        this.tokenAddr = null;
        this.error =
          'Unsupported address format. Enter a P2PKH or P2SH address.';
      }
    } catch (e) {
      this.cashAddr = null;
      this.legacyAddr = null;
      this.tokenAddr = null;
      this.error = e instanceof Error ? e.message : 'Conversion failed';
    }

    this.cd.markForCheck();
  }
}
