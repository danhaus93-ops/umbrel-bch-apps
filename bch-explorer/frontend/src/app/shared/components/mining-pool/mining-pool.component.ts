import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { ThemeService } from '@app/services/theme.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-mining-pool',
  templateUrl: './mining-pool.component.html',
  styleUrls: ['./mining-pool.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiningPoolComponent implements OnInit, OnDestroy {
  private static readonly missingLightLogoSlugs = new Set<string>();
  private themeStateSubscription: Subscription;
  private loadedTheme = 'default';

  constructor(
    private themeService: ThemeService,
    private cd: ChangeDetectorRef
  ) {}

  @Input() slug: string;
  @Input() name: string | null = null;
  @Input() showName: boolean = true;
  @Input() searchText: string | null = null;
  @Input() logoStyle: string | null = null;
  @Input() logoClass: string | null = null;
  @Input() textStyle: string | null = null;
  @Input() textClass: string | null = null;
  @Input() forceStandardLogo: boolean = false;

  ngOnInit(): void {
    this.loadedTheme = this.themeService.theme;
    this.themeStateSubscription = this.themeService.themeChanged$.subscribe(
      (theme) => {
        this.loadedTheme = theme;
        this.cd.markForCheck();
      }
    );
  }

  ngOnDestroy(): void {
    this.themeStateSubscription?.unsubscribe();
  }

  get logoSrc(): string {
    // return `/resources/mining-pools/${this.slug}${this.useLightLogo ? '.light' : ''}.svg`;
    // Currently, we only have the standard logo without .light suffix in the name.
    return `/resources/mining-pools/${this.slug}.svg`;
  }

  get logoAlt(): string {
    return this.name ? `Logo of ${this.name} mining pool` : 'Mining pool logo';
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLImageElement | null;

    if (!target) {
      return;
    }

    // If light logo is missing, fall back to the standard logo and don't try to load the light logo again
    // Currently not used since we only have standard logos (and no light.svg yet)
    // if (this.useLightLogo && target.src.endsWith(`${this.slug}.light.svg`)) {
    //   MiningPoolComponent.missingLightLogoSlugs.add(this.slug);
    //   target.src = `/resources/mining-pools/${this.slug}.svg`;
    //   return;
    // }

    if (
      target.src.endsWith('/resources/mining-pools/default.svg') ||
      target.src.endsWith('/resources/mining-pools/default.light.svg')
    ) {
      return;
    }

    target.src =
      !this.forceStandardLogo && this.loadedTheme === 'light'
        ? '/resources/mining-pools/default.light.svg'
        : '/resources/mining-pools/default.svg';
  }

  get useLightLogo(): boolean {
    return (
      !this.forceStandardLogo &&
      this.loadedTheme === 'light' &&
      !MiningPoolComponent.missingLightLogoSlugs.has(this.slug)
    );
  }
}
