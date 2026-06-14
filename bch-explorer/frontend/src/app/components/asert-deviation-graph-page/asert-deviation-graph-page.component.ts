import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  Input,
  LOCALE_ID,
  OnInit,
} from '@angular/core';
import { Observable } from 'rxjs';
import { map, share, startWith, switchMap, tap } from 'rxjs/operators';
import { ApiService } from '@app/services/api.service';
import { SeoService } from '@app/services/seo.service';
import { UntypedFormBuilder, UntypedFormGroup } from '@angular/forms';
import { StorageService } from '@app/services/storage.service';
import { MiningService } from '@app/services/mining.service';
import { ActivatedRoute } from '@angular/router';
import { download } from '@app/shared/graphs.utils';
import { StateService } from '@app/services/state.service';
import {
  getScheduleOffsetSeconds,
  getAsertAnchorHeight,
} from '@app/shared/asert.utils';
import { AsertPoint } from '@app/components/asert-deviation-graph/asert-deviation-graph.component';
import { EChartsOption } from '@app/graphs/echarts';

@Component({
  selector: 'app-asert-deviation-graph-page',
  templateUrl: './asert-deviation-graph-page.component.html',
  styleUrls: ['./asert-deviation-graph-page.component.scss'],
  styles: [
    `
      .loadingGraphs {
        position: absolute;
        top: 50%;
        left: calc(50% - 15px);
        z-index: 99;
      }
    `,
  ],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AsertDeviationGraphPageComponent implements OnInit {
  @Input() right: number | string = 45;
  @Input() left: number | string = 75;

  miningWindowPreference: string;
  radioGroupForm: UntypedFormGroup;

  statsObservable$: Observable<any>;
  isLoading = true;
  timespan = '';
  chartInstance: any = undefined;
  chartOptions: EChartsOption = {
    grid: {
      left: 40,
      right: 12,
      top: 4,
      bottom: 16,
    },
  };

  asertData: AsertPoint[] = [];

  constructor(
    @Inject(LOCALE_ID) public locale: string,
    private seoService: SeoService,
    private apiService: ApiService,
    private formBuilder: UntypedFormBuilder,
    private storageService: StorageService,
    private miningService: MiningService,
    public stateService: StateService,
    private route: ActivatedRoute
  ) {
    this.radioGroupForm = this.formBuilder.group({ dateSpan: '1y' });
    this.radioGroupForm.controls['dateSpan'].setValue('1y');
  }

  ngOnInit(): void {
    this.seoService.setTitle($localize`Difficulty Adjustment Deviation`);
    this.seoService.setDescription(
      $localize`View Bitcoin Cash ASERT difficulty adjustment deviation over time.`
    );
    this.miningWindowPreference = this.miningService.getDefaultTimespan('1m');
    this.radioGroupForm = this.formBuilder.group({
      dateSpan: this.miningWindowPreference,
    });
    this.radioGroupForm.controls['dateSpan'].setValue(
      this.miningWindowPreference
    );

    this.route.fragment.subscribe((fragment) => {
      if (
        [
          '24h',
          '3d',
          '1w',
          '1m',
          '3m',
          '6m',
          '1y',
          '2y',
          '3y',
          '4y',
          'all',
        ].indexOf(fragment) > -1
      ) {
        this.radioGroupForm.controls['dateSpan'].setValue(fragment, {
          emitEvent: false,
        });
      }
    });

    this.statsObservable$ = this.radioGroupForm
      .get('dateSpan')
      .valueChanges.pipe(
        startWith(this.radioGroupForm.controls['dateSpan'].value),
        switchMap((timespan) => {
          this.isLoading = true;
          this.storageService.setValue('miningWindowPreference', timespan);
          this.timespan = timespan;
          return this.fetchBlocksForTimespan(timespan).pipe(
            tap((blocks) => {
              this.asertData = this.calculateAsertDeviation(blocks);
              this.isLoading = false;
            }),
            map(() => {
              // Always report total blocks since ASERT anchor so all
              // radio buttons stay visible regardless of selected span.
              const currentHeight = this.stateService.latestBlockHeight || 0;
              return {
                blockCount:
                  currentHeight -
                  getAsertAnchorHeight(this.stateService.network),
              };
            })
          );
        }),
        share()
      );
  }

  private fetchBlocksForTimespan(timespan: string) {
    return this.stateService.blocks$.pipe(
      map((blocks) => {
        const maxHeight = blocks.reduce(
          (max, block) => Math.max(max, block.height),
          0
        );
        return maxHeight;
      }),
      switchMap((currentHeight) => {
        const fromHeight = this.calculateFromHeight(timespan, currentHeight);
        return this.apiService.getAsertBlocks$(fromHeight);
      })
    );
  }

  private calculateFromHeight(timespan: string, currentHeight: number): number {
    const blocksPerDay = 144; // Just an approximation (the actual number can varies a lot)
    let blocksBack: number;

    switch (timespan) {
      case '24h':
        blocksBack = blocksPerDay;
        break;
      case '3d':
        blocksBack = blocksPerDay * 3;
        break;
      case '1w':
        blocksBack = blocksPerDay * 7;
        break;
      case '1m':
        blocksBack = blocksPerDay * 30;
        break;
      case '3m':
        blocksBack = blocksPerDay * 90;
        break;
      case '6m':
        blocksBack = blocksPerDay * 180;
        break;
      case '1y':
        blocksBack = blocksPerDay * 365;
        break;
      case '2y':
        blocksBack = blocksPerDay * 730;
        break;
      case '3y':
        blocksBack = blocksPerDay * 1095;
        break;
      case '4y':
        blocksBack = blocksPerDay * 1460;
        break;
      case 'all':
        return getAsertAnchorHeight(this.stateService.network);
      default:
        blocksBack = blocksPerDay * 30;
    }

    const fromHeight = currentHeight - blocksBack;
    return Math.max(
      fromHeight,
      getAsertAnchorHeight(this.stateService.network)
    );
  }

  private calculateAsertDeviation(blocks: any[]): AsertPoint[] {
    if (!blocks || blocks.length === 0) {
      return [];
    }

    const sorted = [...blocks].sort((a, b) => a.h - b.h);

    const absolutePoints = sorted.map((block) => ({
      height: block.h,
      deviation: getScheduleOffsetSeconds(
        block.h,
        block.t,
        this.stateService.network
      ),
      timestamp: block.t,
    }));

    // Normalize: subtract first point's deviation so chart centers at 0
    const baseline =
      absolutePoints.length > 0 ? absolutePoints[0].deviation : 0;
    return absolutePoints.map((p) => ({
      height: p.height,
      deviation: p.deviation - baseline,
      timestamp: p.timestamp,
    }));
  }

  onChartInit(ec) {
    this.chartInstance = ec;
  }

  onChartOptionsChange(options: any) {
    this.chartOptions = options;
  }

  isMobile() {
    return window.innerWidth <= 767.98;
  }

  onSaveChart() {
    const now = new Date();
    const prevBottom = (this.chartOptions['grid'] as any).bottom;
    (this.chartOptions['grid'] as any).bottom = 40;
    this.chartOptions['backgroundColor'] = 'var(--active-bg)';
    this.chartInstance.setOption(this.chartOptions);
    download(
      this.chartInstance.getDataURL({
        pixelRatio: 2,
        excludeComponents: ['dataZoom'],
      }),
      `asert-deviation-${this.timespan}-${Math.round(now.getTime() / 1000)}.svg`
    );
    (this.chartOptions['grid'] as any).bottom = prevBottom;
    this.chartOptions['backgroundColor'] = 'none';
    this.chartInstance.setOption(this.chartOptions);
  }
}
