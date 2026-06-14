import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  Input,
  LOCALE_ID,
  OnInit,
  HostBinding,
} from '@angular/core';
import { echarts, EChartsOption } from '@app/graphs/echarts';
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

@Component({
  selector: 'app-utxo-size-graph',
  templateUrl: './utxo-size-graph.component.html',
  styleUrls: ['./utxo-size-graph.component.scss'],
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
export class UtxoSizeGraphComponent implements OnInit {
  @Input() right: number | string = 45;
  @Input() left: number | string = 75;

  miningWindowPreference: string;
  radioGroupForm: UntypedFormGroup;

  chartOptions: EChartsOption = {};
  chartInitOptions = {
    renderer: 'svg',
  };

  @HostBinding('attr.dir') dir = 'ltr';

  utxoSizeObservable$: Observable<any>;
  isLoading = true;
  formatNumber = formatNumber;
  timespan = '';
  chartInstance: any = undefined;

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

    this.seoService.setTitle($localize`UTXO Count`);
    this.seoService.setDescription(
      $localize`See the total number of unspent transaction outputs (UTXOs) on the Bitcoin Cash network over time.`
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

    this.utxoSizeObservable$ = this.radioGroupForm
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
          return this.apiService.getHistoricalUtxoSize$(timespan).pipe(
            tap((response) => {
              const raw = response.body.utxos;
              const utxos = raw.map((val: any) => [
                val.timestamp * 1000,
                val.avgUtxoSize / 1_000_000,
                val.avgHeight,
              ]);
              this.prepareChartOptions({ utxos });
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

  prepareChartOptions(data) {
    let title: object;
    if (data.utxos.length === 0) {
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
      color: [
        new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: '#00E676' },
          { offset: 1, color: '#00796B' },
        ]),
      ],
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
            if (tick.seriesIndex === 0) {
              tooltip += `${tick.marker} ${tick.seriesName}: ${formatNumber(
                tick.data[1],
                this.locale,
                '1.2-2'
              )} M UTXOs`;
            }
            tooltip += `<br>`;
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
        data.utxos.length === 0
          ? undefined
          : {
              type: 'time',
              splitNumber: this.isMobile() ? 5 : 10,
              axisLabel: {
                hideOverlap: true,
              },
            },
      yAxis:
        data.utxos.length === 0
          ? undefined
          : [
              {
                type: 'value',
                position: 'left',
                min: (value) => {
                  return value.min * 0.9;
                },
                axisLabel: {
                  color: 'var(--grey)',
                  formatter: (val) => {
                    return `${Math.round(val * 100) / 100} M`;
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
        data.utxos.length === 0
          ? []
          : [
              {
                zlevel: 1,
                name: $localize`UTXO Count`,
                showSymbol: false,
                symbol: 'none',
                data: data.utxos,
                type: 'line',
                lineStyle: {
                  width: 2,
                  color: '#00E676',
                },
                areaStyle: {
                  color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(0, 230, 118, 0.3)' },
                    { offset: 1, color: 'rgba(0, 121, 107, 0.04)' },
                  ]),
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
      `utxo-size-${this.timespan}-${Math.round(now.getTime() / 1000)}.svg`
    );
    // @ts-ignore
    this.chartOptions.grid.bottom = prevBottom;
    this.chartOptions.backgroundColor = 'none';
    this.chartInstance.setOption(this.chartOptions);
  }
}
