import { Component, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { OpenGraphService } from '@app/services/opengraph.service';
import { ThemeService } from '@app/services/theme.service';

@Component({
  selector: 'app-privacy-policy',
  templateUrl: './privacy-policy.component.html',
  styleUrls: ['./privacy-policy.component.scss'],
  standalone: false,
})
export class PrivacyPolicyComponent implements OnDestroy {
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
    this.seoService.setTitle('Privacy Policy');
    this.seoService.setDescription(
      'Trusted third parties are security holes, as are trusted first parties...you should only trust your own self-hosted instance of The Mempool Open Source Project®.'
    );
    this.ogService.setManualOgImage('privacy.jpg');

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
