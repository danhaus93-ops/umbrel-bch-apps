import { Component, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { OpenGraphService } from '@app/services/opengraph.service';
import { ThemeService } from '@app/services/theme.service';

@Component({
  selector: 'app-terms-of-service',
  templateUrl: './terms-of-service.component.html',
  standalone: false,
})
export class TermsOfServiceComponent implements OnDestroy {
  officialBCHExplorer = false;
  themeSubscription: Subscription;
  loadedTheme: string;

  constructor(
    private seoService: SeoService,
    private ogService: OpenGraphService,
    private themeService: ThemeService,
    private stateService: StateService
  ) {
    this.officialBCHExplorer = this.stateService.env.OFFICIAL_BCH_EXPLORER;
    this.loadedTheme = this.themeService.theme;
  }

  ngOnInit(): void {
    this.seoService.setTitle('Terms of Service');
    this.seoService.setDescription(
      'Out of respect for the Bitcoin Cash community, the bchexplorer.cash website is Bitcoin Cash Only and does not display any advertising.'
    );
    this.ogService.setManualOgImage('tos.jpg');

    this.themeSubscription = this.themeService.themeChanged$.subscribe(
      (theme) => {
        this.loadedTheme = theme;
      }
    );
  }

  get isLightMode(): boolean {
    return this.loadedTheme === 'light';
  }

  ngOnDestroy(): void {
    this.themeSubscription?.unsubscribe();
  }
}
