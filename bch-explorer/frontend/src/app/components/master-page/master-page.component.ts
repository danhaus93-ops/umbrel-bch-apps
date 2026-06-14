import { Component, OnInit, OnDestroy, Input, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Env, StateService } from '@app/services/state.service';
import { Observable, merge, of, Subscription } from 'rxjs';
import { LanguageService } from '@app/services/language.service';
import { EnterpriseService } from '@app/services/enterprise.service';
import { NavigationService } from '@app/services/navigation.service';
import { MenuComponent } from '@components/menu/menu.component';
import { SharedModule } from '@app/shared/shared.module';
// import { StorageService } from '@app/services/storage.service';

@Component({
  selector: 'app-master-page',
  templateUrl: './master-page.component.html',
  styleUrls: ['./master-page.component.scss'],
  imports: [CommonModule, SharedModule],
})
export class MasterPageComponent implements OnInit, OnDestroy {
  @Input() headerVisible = true;
  @Input() footerVisibleOverride: boolean | null = null;

  env: Env;
  network$: Observable<string>;
  connectionState$: Observable<number>;
  navCollapsed = false;
  isMobile = window.innerWidth <= 767.98;
  isOfficialSiteBuild: boolean;
  urlLanguage: string;
  subdomain = '';
  networkPaths: { [network: string]: string };
  networkPaths$: Observable<Record<string, string>>;
  footerVisible = true;
  user: any = undefined;
  menuOpen = false;
  isDropdownVisible: boolean;

  enterpriseInfo: any;
  enterpriseInfo$: Subscription;

  @ViewChild(MenuComponent)
  public menuComponent!: MenuComponent;

  constructor(
    public stateService: StateService,
    private languageService: LanguageService,
    private enterpriseService: EnterpriseService,
    private navigationService: NavigationService,
    // private storageService: StorageService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.env = this.stateService.env;
    this.isOfficialSiteBuild = this.stateService.isofficialBCHExplorerSiteBuild;
    this.connectionState$ = this.stateService.connectionState$;
    this.network$ = merge(of(''), this.stateService.networkChanged$);
    this.urlLanguage = this.languageService.getLanguageForUrl();
    this.subdomain = this.enterpriseService.getSubdomain();
    this.navigationService.subnetPaths.subscribe((paths) => {
      this.networkPaths = paths;
      if (this.footerVisibleOverride === null) {
        if (paths['mainnet'].indexOf('docs') > -1) {
          this.footerVisible = false;
        } else {
          this.footerVisible = true;
        }
      } else {
        this.footerVisible = this.footerVisibleOverride;
      }
    });
    this.enterpriseInfo$ = this.enterpriseService.info$.subscribe((info) => {
      this.enterpriseInfo = info;
    });

    // this.refreshAuth();

    const isServicesPage = this.router.url.includes('/services/');
    this.menuOpen = isServicesPage && !this.isSmallScreen();
    this.setDropdownVisibility();
  }

  setDropdownVisibility(): void {
    const networks = [
      this.env.TESTNET4_ENABLED,
      this.env.SCALENET_ENABLED,
      this.env.CHIPNET_ENABLED,
      this.env.MAINNET_ENABLED,
    ];
    const enabledNetworksCount = networks.filter(
      (networkEnabled) => networkEnabled
    ).length;
    this.isDropdownVisible = enabledNetworksCount > 1;
  }

  collapse(): void {
    this.navCollapsed = !this.navCollapsed;
  }

  isSmallScreen(): boolean {
    return window.innerWidth <= 767.98;
  }

  onResize(): void {
    this.isMobile = this.isSmallScreen();
  }

  brandClick(e): void {
    this.stateService.resetScroll$.next(true);
  }

  // onLoggedOut(): void {
  //   this.refreshAuth();
  // }

  // refreshAuth(): void {
  //   this.user = this.storageService.getAuth()?.user ?? null;
  // }

  hamburgerClick(event): void {
    if (this.menuComponent) {
      this.menuComponent.hamburgerClick();
      this.menuOpen = this.menuComponent.navOpen;
      event.stopPropagation();
    }
  }

  menuToggled(isOpen: boolean): void {
    this.menuOpen = isOpen;
  }

  ngOnDestroy(): void {
    if (this.enterpriseInfo$) {
      this.enterpriseInfo$.unsubscribe();
    }
  }
}
