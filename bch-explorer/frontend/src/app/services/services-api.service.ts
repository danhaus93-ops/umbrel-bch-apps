import { Router, NavigationStart } from '@angular/router';
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { StorageService } from '@app/services/storage.service';
import { MenuGroup } from '@interfaces/services.interface';
import {
  Observable,
  of,
  ReplaySubject,
  tap,
  catchError,
  share,
  filter,
  switchMap,
} from 'rxjs';
import { IBackendInfo } from '@interfaces/websocket.interface';
import { SimpleProof } from '@components/simpleproof-widget/simpleproof-widget.component';

export interface IUser {
  username: string;
  email: string | null;
  passwordIsSet: boolean;
  snsId: string;
  type: 'enterprise' | 'community' | 'mining_pool';
  subscription_tag: string;
  status: 'pending' | 'verified' | 'disabled';
  features: string | null;
  countryCode: string | null;
  imageMd5: string;
  ogRank: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class ServicesApiServices {
  apiBaseUrl: string; // base URL is protocol, hostname, and port
  apiBasePath: string; // network path is /testnet, etc. or '' for mainnet

  userSubject$ = new ReplaySubject<IUser | null>(1);
  currentAuth = null;

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService,
    private storageService: StorageService,
    private router: Router
  ) {
    this.currentAuth = localStorage.getItem('auth');

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
      this.apiBasePath = network ? '/' + network : '';
    });

    if (this.stateService.env.GIT_COMMIT_HASH_MEMPOOL_SPACE) {
      this.getServicesBackendInfo$().subscribe((version) => {
        this.stateService.servicesBackendInfo$.next(version);
      });
    }

    this.getUserInfo$().subscribe();
    this.router.events
      .pipe(
        filter(
          (event) =>
            event instanceof NavigationStart &&
            this.currentAuth !== localStorage.getItem('auth')
        ),
        switchMap(() => this.getUserInfo$())
      )
      .subscribe();
  }

  /**
   * Do not call directly, userSubject$ instead
   */
  private getUserInfo$() {
    return this.getUserInfoApi$().pipe(
      tap((user) => {
        this.userSubject$.next(user);
      }),
      catchError((e) => {
        if (e.error === 'invalid_user') {
          this.userSubject$.next(null);
          this.logout$().subscribe();
          return of(null);
        }
        this.userSubject$.next(null);
        return of(null);
      }),
      share()
    );
  }

  /**
   * Do not call directly, userSubject$ instead
   */
  private getUserInfoApi$(): Observable<any> {
    const auth = this.storageService.getAuth();
    if (!auth) {
      return of(null);
    }

    return this.httpClient.get<any>(
      `${this.stateService.env.SERVICES_API}/account`
    );
  }

  getUserMenuGroups$(): Observable<MenuGroup[]> {
    const auth = this.storageService.getAuth();
    if (!auth) {
      return of(null);
    }

    return this.httpClient.get<MenuGroup[]>(
      `${this.stateService.env.SERVICES_API}/account/menu`
    );
  }

  logout$(): Observable<any> {
    const auth = this.storageService.getAuth();
    if (!auth) {
      return of(null);
    }

    localStorage.removeItem('auth');
    return this.httpClient.post(
      `${this.stateService.env.SERVICES_API}/auth/logout`,
      {}
    );
  }

  getJWT$() {
    if (!this.stateService.env.OFFICIAL_BCH_EXPLORER) {
      return of(null);
    }
    return this.httpClient.get<any>(
      `${this.stateService.env.SERVICES_API}/auth/getJWT`
    );
  }

  getServicesBackendInfo$(): Observable<IBackendInfo> {
    return this.httpClient.get<IBackendInfo>(
      `${this.stateService.env.SERVICES_API}/version`
    );
  }

  setupSquare$(): Observable<{
    squareAppId: string;
    squareLocationId: string;
  }> {
    return this.httpClient.get<{
      squareAppId: string;
      squareLocationId: string;
    }>(`${this.stateService.env.SERVICES_API}/square/setup`);
  }

  getFaucetStatus$() {
    return this.httpClient.get<{
      address?: string;
      min: number;
      max: number;
      code:
        | 'ok'
        | 'faucet_not_available'
        | 'faucet_maximum_reached'
        | 'faucet_too_soon';
    }>(`${this.stateService.env.SERVICES_API}/testnet4/faucet/status`, {
      responseType: 'json',
    });
  }

  requestTestnet4Coins$(address: string, sats: number) {
    return this.httpClient.get<{ txid: string }>(
      `${this.stateService.env.SERVICES_API}/testnet4/faucet/request?address=${address}&sats=${sats}`,
      { responseType: 'json' }
    );
  }

  generateBTCPayAcceleratorInvoice$(
    txid: string,
    sats: number
  ): Observable<any> {
    const params = {
      product: txid,
      amount: sats,
    };
    return this.httpClient.post<any>(
      `${this.stateService.env.SERVICES_API}/payments/bitcoin`,
      params
    );
  }

  retrieveInvoice$(invoiceId: string): Observable<any[]> {
    return this.httpClient.get<any[]>(
      `${this.stateService.env.SERVICES_API}/payments/bitcoin/invoice?id=${invoiceId}`
    );
  }

  getPaymentStatus$(orderId: string): Observable<any> {
    return this.httpClient.get<any>(
      `${this.stateService.env.SERVICES_API}/payments/bitcoin/check?order_id=${orderId}`,
      { observe: 'response' }
    );
  }

  getSimpleProofs$(key: string): Observable<Record<string, SimpleProof>> {
    // Need to use relative path here to avoid CORS errors, since this won't be used from bchexplorer.cash website
    const pathname = new URL(
      this.stateService.env.SERVICES_API + '/sp/verified'
    ).pathname;
    return this.httpClient.get<Record<string, SimpleProof>>(
      `${pathname}/${key}`
    );
  }
}
