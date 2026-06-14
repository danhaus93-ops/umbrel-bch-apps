import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { BcmrService } from '@app/services/bcmr.service';
import {
  BcmrMetadata,
  URIs,
  Genesis,
} from '@app/interfaces/bcmr-api.interface';
import { Subscription } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';

interface TokenInfo {
  category: string;
  name: string;
  symbol: string;
  decimals: number;
  description: string;
  uris: URIs;
  hasIcon: boolean;
  hasWebsite: boolean;
  hasDescription: boolean;
  isNft: boolean;
  nftType: string | null;
  genesis: Genesis | null;
  status: 'active' | 'burned' | 'inactive' | 'unknown';
  trust: 'absent' | 'marginal' | 'good' | 'high' | 'ultimate' | null;
}

@Component({
  selector: 'app-token-details',
  templateUrl: './token-details.component.html',
  styleUrls: ['./token-details.component.scss'],
  standalone: false,
})
export class TokenDetailsComponent implements OnInit, OnDestroy {
  private readonly IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
  category: string;
  metadata: BcmrMetadata | null = null;
  isLoading = true;
  error: any = null;
  network = '';
  networkChangeSubscription: Subscription;
  showQR = false;
  isMobile: boolean;

  constructor(
    private route: ActivatedRoute,
    private bcmrService: BcmrService,
    private seoService: SeoService,
    private stateService: StateService
  ) {}

  ngOnInit(): void {
    this.network = this.stateService.network;
    this.networkChangeSubscription =
      this.stateService.networkChanged$.subscribe((network) => {
        this.network = network;
      });

    this.route.paramMap
      .pipe(
        switchMap((params: ParamMap) => {
          this.category = params.get('category') || '';
          this.isLoading = true;
          this.metadata = null;

          this.seoService.setTitle(`Cash Token: ${this.category}`);
          this.seoService.setDescription(
            `View details for Bitcoin Cash token ${this.category} including name, symbol, decimals, description and more.`
          );

          return this.bcmrService.getBcmrMetadata(this.category).pipe(
            catchError((err) => {
              this.error = err;
              this.isLoading = false;
              console.error('Error fetching token metadata:', err);
              return of(null);
            })
          );
        })
      )
      .subscribe((metadata: BcmrMetadata | null) => {
        this.metadata = metadata;
        this.isLoading = false;
      });
  }

  ngOnDestroy(): void {
    this.networkChangeSubscription?.unsubscribe();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.isMobile = window.innerWidth < 768;
  }

  getTokenInfo(): TokenInfo | null {
    if (!this.metadata || !this.category) {
      return null;
    }

    return {
      category: this.category,
      name: this.metadata.name || 'Unknown',
      symbol: this.metadata.token?.symbol || 'N/A',
      decimals: this.metadata.token?.decimals ?? 0,
      description: this.metadata.description || 'No description available',
      uris: this.metadata.uris || {},
      hasIcon: !!this.metadata.uris?.['icon'],
      hasWebsite: !!this.metadata.uris?.['web'],
      hasDescription: !!this.metadata.description,
      isNft: this.metadata.is_nft || false,
      nftType: this.metadata.nft_type || null,
      genesis: this.metadata.genesis || null,
      status: this.metadata.status || 'unknown',
      trust: this.metadata.trust || null,
    };
  }

  resolveIconUrl(icon?: string): string | null {
    if (!icon) return null;
    if (icon.startsWith('ipfs://')) {
      return this.IPFS_GATEWAY + icon.slice('ipfs://'.length);
    }
    return icon; // http(s) already fine
  }

  improveUri(uri?: string): string | null {
    if (!uri) return null;
    // Rename Twitter to X
    if (uri.includes('twitter.com')) {
      return uri.replace('twitter.com', 'x.com');
    }
    return uri;
  }

  improveKeyName(key?: string): string | null {
    if (!key) return null;
    // Rename Twitter to X
    if (key.startsWith('twitter')) {
      return 'X';
    }
    return key;
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

  getStatusClass(status: string): string {
    switch (status.toLowerCase()) {
      case 'active':
        return 'bg-success';
      case 'burned':
        return 'bg-danger';
      case 'inactive':
        return 'bg-warning';
      default:
        return 'bg-secondary';
    }
  }

  getTrustClass(trust: string): string {
    switch (trust.toLowerCase()) {
      case 'absent':
        return 'trust-absent';
      case 'marginal':
        return 'trust-marginal';
      case 'good':
        return 'trust-good';
      case 'high':
        return 'trust-high';
      case 'ultimate':
        return 'trust-ultimate';
      default:
        return 'bg-secondary';
    }
  }

  getAdditionalUris(uris: any): Array<{ key: string; value: string }> {
    const excludedKeys = ['icon', 'web'];
    return Object.entries(uris)
      .filter(([key]) => !excludedKeys.includes(key))
      .map(([key, value]) => ({ key, value: String(value) }));
  }

  hasAdditionalUris(uris: any): boolean {
    const excludedKeys = ['icon', 'web'];
    return Object.entries(uris).some(([key]) => !excludedKeys.includes(key));
  }
}
