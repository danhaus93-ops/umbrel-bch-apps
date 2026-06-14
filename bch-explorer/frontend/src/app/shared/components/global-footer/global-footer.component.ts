import {
  Input,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  OnChanges,
  SimpleChanges,
  Inject,
  LOCALE_ID,
  OnDestroy,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Observable, merge, of, Subject, Subscription } from 'rxjs';
import { tap, takeUntil } from 'rxjs/operators';
import { Env, StateService } from '@app/services/state.service';
import { IBackendInfo } from '@interfaces/websocket.interface';
import { LanguageService } from '@app/services/language.service';
import { NavigationService } from '@app/services/navigation.service';
import { StorageService } from '@app/services/storage.service';
import { WebsocketService } from '@app/services/websocket.service';
import { EnterpriseService } from '@app/services/enterprise.service';

@Component({
  selector: 'app-global-footer',
  templateUrl: './global-footer.component.html',
  styleUrls: ['./global-footer.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalFooterComponent implements OnInit, OnDestroy, OnChanges {
  @Input() user: any = undefined;

  private destroy$: Subject<any> = new Subject<any>();
  env: Env;
  officialBCHExplorerSite = false;
  isofficialBCHExplorerBuild = window['isOfficialSiteBuild'];
  backendInfo$: Observable<IBackendInfo>;
  servicesBackendInfo$: Observable<IBackendInfo>;
  frontendGitCommitHash: string;
  packetJsonVersion: string;
  urlLanguage: string;
  network$: Observable<string>;
  networkPaths: { [network: string]: string };
  currentNetwork = '';
  urlSubscription: Subscription;
  isServicesPage = false;

  enterpriseInfo: any;
  enterpriseInfo$: Subscription;

  constructor(
    public stateService: StateService,
    private languageService: LanguageService,
    private navigationService: NavigationService,
    private enterpriseService: EnterpriseService,
    @Inject(LOCALE_ID) public locale: string,
    private storageService: StorageService,
    private route: ActivatedRoute,
    private cd: ChangeDetectorRef,
    private websocketService: WebsocketService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.isServicesPage = this.router.url.includes('/services/');

    this.env = this.stateService.env;
    this.officialBCHExplorerSite = this.env.OFFICIAL_BCH_EXPLORER;
    this.frontendGitCommitHash = this.env.GIT_COMMIT_HASH;
    this.packetJsonVersion = this.env.PACKAGE_JSON_VERSION;
    this.backendInfo$ = this.stateService.backendInfo$;
    this.servicesBackendInfo$ = this.stateService.servicesBackendInfo$;
    this.urlLanguage = this.languageService.getLanguageForUrl();
    this.navigationService.subnetPaths.subscribe((paths) => {
      this.networkPaths = paths;
    });
    this.enterpriseInfo$ = this.enterpriseService.info$.subscribe((info) => {
      this.enterpriseInfo = info;
    });
    this.network$ = merge(of(''), this.stateService.networkChanged$).pipe(
      tap((network: string) => {
        return network;
      })
    );
    this.network$.pipe(takeUntil(this.destroy$)).subscribe((network) => {
      this.currentNetwork = network;
    });

    this.urlSubscription = this.route.url.subscribe((url) => {
      this.user = this.storageService.getAuth();
      this.cd.markForCheck();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['user']) {
      this.user = this.storageService.getAuth();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next(true);
    this.destroy$.complete();
    this.urlSubscription.unsubscribe();
    if (this.enterpriseInfo$) {
      this.enterpriseInfo$.unsubscribe();
    }
  }

  networkLink(network) {
    const thisNetwork = network || 'mainnet';
    if (
      network === '' ||
      network === 'mainnet' ||
      network === 'testnet4' ||
      network === 'scalenet' ||
      network === 'chipnet'
    ) {
      return (
        (this.env.BASE_MODULE === 'explorer'
          ? ''
          : this.env.WEBSITE_URL + this.urlLanguage) +
          this.networkPaths[thisNetwork] || '/'
      );
    }
    return undefined;
  }
}
