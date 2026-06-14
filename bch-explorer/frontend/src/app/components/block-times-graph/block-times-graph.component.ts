import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  Input,
  LOCALE_ID,
  OnInit,
  HostBinding,
} from '@angular/core';
import { EChartsOption } from '@app/graphs/echarts';
import { Observable } from 'rxjs';
import { map, share, startWith, switchMap, tap } from 'rxjs/operators';
import { ApiService } from '@app/services/api.service';
import { SeoService } from '@app/services/seo.service';
import { formatNumber } from '@angular/common';
import { UntypedFormBuilder, UntypedFormGroup } from '@angular/forms';
import { StorageService } from '@app/services/storage.service';
import { MiningService } from '@app/services/mining.service';
import { ActivatedRoute } from '@angular/router';
import { download, formatterXAxis } from '@app/shared/graphs.utils';
import { StateService } from '@app/services/state.service';

const TARGET_BLOCK_TIME_SECONDS = 600; // BCH target block interval; update if consensus changes

@Component({
  selector: 'app-block-times-graph',
  templateUrl: './block-times-graph.component.html',
  styleUrls: ['./block-times-graph.component.scss'],
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
export class BlockTimesGraphComponent implements OnInit {
  @Input() right: number | string = 45;
  @Input() left: number | string = 75;

  miningWindowPreference: string;
  radioGroupForm: UntypedFormGroup;

  chartOptions: EChartsOption = {};
  chartInitOptions = {
    renderer: 'svg',
  };

  @HostBinding('attr.dir') dir = 'ltr';

  blockTimesObservable$: Observable<any>;
  isLoading = true;
  formatNumber = formatNumber;
  timespan = '';
  chartInstance: any = undefined;
  private currentMedian = 0;

  constructor(
    @Inject(LOCALE_ID) public locale: string,
    private seoService: SeoService,
    private apiService: ApiService,
    private formBuilder: UntypedFormBuilder,
    private storageService: StorageService,
    private miningService: MiningService,
    public stateService: StateService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    let firstRun = true;

    this.seoService.setTitle($localize`Block Time Variation`);
    this.seoService.setDescription(
      $localize`See Bitcoin Cash block time variation over time.`
    );
    this.miningWindowPreference = this.miningService.getDefaultTimespan('24h');
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

    this.blockTimesObservable$ = this.radioGroupForm
      .get('dateSpan')
      .valueChanges.pipe(
        startWith(this.radioGroupForm.controls['dateSpan'].value),
        switchMap((timespan) => {
          this.timespan = timespan;
          if (!firstRun) {
            this.storageService.setValue('miningWindowPreference', timespan);
          }
          firstRun = false;
          this.miningWindowPreference = timespan;
          this.isLoading = true;
          return this.apiService.getHistoricalBlockTimeDiffs$(timespan).pipe(
            tap((response) => {
              const raw = response.body.timeDiffs;
              const timeDiffs = raw.map((val: any) => [
                val.timestamp * 1000,
                ((val.timeDiff ?? val.avgTimeDiff) as number) / 60,
                val.height ?? val.avgHeight,
              ]);
              this.prepareChartOptions({ timeDiffs });
              this.isLoading = false;
            }),
            map((response) => ({
              blockCount: parseInt(response.headers.get('x-total-count'), 10),
            }))
          );
        }),
        share()
      );
  }

  private computeSma(timeDiffs: number[][], window: number): number[][] {
    return timeDiffs.map((point, i) => {
      const start = Math.max(0, i - window + 1);
      const slice = timeDiffs.slice(start, i + 1);
      const avg = slice.reduce((sum, p) => sum + p[1], 0) / slice.length;
      return [point[0], avg, point[2]];
    });
  }

  private computeMedianLine(timeDiffs: number[][]): number[][] {
    if (timeDiffs.length === 0) return [];
    const sorted = timeDiffs.map((p) => p[1]).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    this.currentMedian =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    return [
      [timeDiffs[0][0], this.currentMedian, timeDiffs[0][2]],
      [
        timeDiffs[timeDiffs.length - 1][0],
        this.currentMedian,
        timeDiffs[timeDiffs.length - 1][2],
      ],
    ];
  }

  prepareChartOptions(data) {
    const smaData = this.computeSma(data.timeDiffs, 144);
    const medianData = this.computeMedianLine(data.timeDiffs);

    let title: object;
    if (data.timeDiffs.length === 0) {
      title = {
        textStyle: {
          color: 'var(--fg)',
          fontSize: 15,
        },
        text: $localize`:@@23555386d8af1ff73f297e89dd4af3f4689fb9dd:Indexing blocks`,
        left: 'center',
        top: 'center',
      };
    }

    this.chartOptions = {
      title: title,
      animation: false,
      color: ['#FDD835', '#FF6B6B', '#4FC3F7'],
      legend:
        data.timeDiffs.length === 0
          ? undefined
          : {
              top: 0,
              data: [
                {
                  name: $localize`Block Time`,
                  inactiveColor: 'rgb(110, 112, 121)',
                  textStyle: { color: 'var(--fg)' },
                  icon: 'roundRect',
                },
                {
                  name: $localize`Block time (SMA 144)`,
                  inactiveColor: 'rgb(110, 112, 121)',
                  textStyle: { color: 'var(--fg)' },
                  icon: 'roundRect',
                },
                {
                  name: $localize`Block time (Median)`,
                  inactiveColor: 'rgb(110, 112, 121)',
                  textStyle: { color: 'var(--fg)' },
                  icon: 'roundRect',
                },
              ],
              selected:
                JSON.parse(
                  this.storageService?.getValue('block_times_legend') || 'null'
                ) ?? {},
            },
      grid: {
        top: 30,
        bottom: 70,
        right: this.right,
        left: this.left,
      },
      tooltip: {
        show: !this.isMobile(),
        trigger: 'axis',
        axisPointer: {
          type: 'line',
        },
        backgroundColor: 'var(--bg)',
        borderRadius: 4,
        shadowColor: 'rgba(0, 0, 0, 0.5)',
        textStyle: {
          color: 'var(--tooltip-grey)',
          align: 'left',
        },
        borderColor: 'var(--hover-bg)',
        formatter: (ticks) => {
          let tooltip = `<b style="color: var(--fg); margin-left: 2px">${formatterXAxis(
            this.locale,
            this.timespan,
            parseInt(ticks[0].axisValue, 10)
          )}</b><br>`;

          for (const tick of ticks) {
            if ([0, 1].includes(tick.seriesIndex)) {
              tooltip += `${tick.marker} ${tick.seriesName}: ${formatNumber(
                tick.data[1],
                this.locale,
                '1.2-2'
              )} min<br>`;
            }
          }

          if (['24h', '3d'].includes(this.timespan)) {
            tooltip +=
              `<small>` + $localize`At block: ${ticks[0].data[2]}` + `</small>`;
          } else {
            tooltip +=
              `<small>` +
              $localize`Around block: ${ticks[0].data[2]}` +
              `</small>`;
          }

          return tooltip;
        },
      },
      xAxis:
        data.timeDiffs.length === 0
          ? undefined
          : {
              type: 'time',
              splitNumber: this.isMobile() ? 5 : 10,
              axisLabel: {
                hideOverlap: true,
              },
            },
      yAxis:
        data.timeDiffs.length === 0
          ? undefined
          : [
              {
                type: 'value',
                position: 'left',
                min: 0,
                axisLabel: {
                  color: 'var(--grey)',
                  formatter: (val) => {
                    return `${Math.round(val * 100) / 100} min`;
                  },
                },
                splitLine: {
                  lineStyle: {
                    type: 'dotted',
                    color: 'var(--transparent-fg)',
                    opacity: 0.25,
                  },
                },
              },
            ],
      series:
        data.timeDiffs.length === 0
          ? []
          : [
              {
                zlevel: 1,
                name: $localize`Block Time`,
                showSymbol: false,
                symbol: 'none',
                data: data.timeDiffs,
                type: 'line',
                lineStyle: {
                  width: 1.5,
                },
                markLine: {
                  silent: true,
                  symbol: 'none',
                  lineStyle: {
                    type: 'solid',
                    color: 'var(--transparent-fg)',
                    opacity: 1,
                    width: 2,
                  },
                  data: [
                    {
                      yAxis: TARGET_BLOCK_TIME_SECONDS / 60,
                      label: {
                        position: 'end',
                        show: true,
                        color: 'var(--fg)',
                        formatter: `${TARGET_BLOCK_TIME_SECONDS / 60} min`,
                      },
                    },
                  ],
                },
              },
              {
                zlevel: 2,
                name: $localize`Block time (SMA 144)`,
                showSymbol: false,
                symbol: 'none',
                data: smaData,
                type: 'line',
                lineStyle: {
                  width: 2,
                  color: '#FF6B6B',
                },
                itemStyle: {
                  color: '#FF6B6B',
                },
              },
              {
                zlevel: 3,
                name: $localize`Block time (Median)`,
                showSymbol: false,
                symbol: 'none',
                data: medianData,
                type: 'line',
                lineStyle: {
                  width: 2,
                  type: 'dashed',
                  color: '#4FC3F7',
                },
                itemStyle: {
                  color: '#4FC3F7',
                },
              },
            ],
      dataZoom: [
        {
          type: 'inside',
          realtime: true,
          zoomLock: true,
          maxSpan: 100,
          minSpan: 5,
          moveOnMouseMove: false,
        },
        {
          showDetail: false,
          show: true,
          type: 'slider',
          brushSelect: false,
          realtime: true,
          left: 20,
          right: 15,
          selectedDataBackground: {
            lineStyle: {
              color: 'var(--fg)',
              opacity: 0.45,
            },
            areaStyle: {
              opacity: 0,
            },
          },
        },
      ],
    };
  }

  onChartInit(ec) {
    if (this.chartInstance !== undefined) {
      return;
    }
    this.chartInstance = ec;

    this.chartInstance.on(
      'legendselectchanged',
      (e: { selected: Record<string, boolean> }) => {
        this.storageService.setValue(
          'block_times_legend',
          JSON.stringify(e.selected)
        );
      }
    );
  }

  isMobile() {
    return window.innerWidth <= 767.98;
  }

  onSaveChart() {
    // @ts-ignore
    const prevBottom = this.chartOptions.grid.bottom;
    const now = new Date();
    // @ts-ignore
    this.chartOptions.grid.bottom = 40;
    this.chartOptions.backgroundColor = 'var(--active-bg)';
    this.chartInstance.setOption(this.chartOptions);
    download(
      this.chartInstance.getDataURL({
        pixelRatio: 2,
        excludeComponents: ['dataZoom'],
      }),
      `block-times-${this.timespan}-${Math.round(now.getTime() / 1000)}.svg`
    );
    // @ts-ignore
    this.chartOptions.grid.bottom = prevBottom;
    this.chartOptions.backgroundColor = 'none';
    this.chartInstance.setOption(this.chartOptions);
  }
}
