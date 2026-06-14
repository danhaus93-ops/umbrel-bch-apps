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

@Component({
  selector: 'app-block-volume-graph',
  templateUrl: './block-volume-graph.component.html',
  styleUrls: ['./block-volume-graph.component.scss'],
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
export class BlockVolumeGraphComponent implements OnInit {
  @Input() right: number | string = 90;
  @Input() left: number | string = 75;

  miningWindowPreference: string;
  radioGroupForm: UntypedFormGroup;

  chartOptions: EChartsOption = {};
  chartInitOptions = {
    renderer: 'svg',
  };

  @HostBinding('attr.dir') dir = 'ltr';

  blockVolumeObservable$: Observable<any>;
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

    this.seoService.setTitle($localize`Block Volume`);
    this.seoService.setDescription(
      $localize`See the total UTXO throughput and BCH transaction volume per Bitcoin Cash block over time.`
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

    this.blockVolumeObservable$ = this.radioGroupForm
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
          return this.apiService.getHistoricalBlockVolume$(timespan).pipe(
            tap((response) => {
              const raw = response.body.volume;
              const utxoInputs = raw.map((v: any) => [
                v.timestamp * 1000,
                v.avgTotalInputs,
                v.avgHeight,
              ]);
              const utxoOutputs = raw.map((v: any) => [
                v.timestamp * 1000,
                v.avgTotalOutputs,
                v.avgHeight,
              ]);
              const outputAmts = raw.map((v: any) => [
                v.timestamp * 1000,
                v.avgTotalOutputAmt,
                v.avgHeight,
              ]);
              const inputAmts = raw.map((v: any) => [
                v.timestamp * 1000,
                v.avgTotalInputAmt != null ? v.avgTotalInputAmt / 1e8 : null,
                v.avgHeight,
              ]);
              this.prepareChartOptions({
                utxoInputs,
                utxoOutputs,
                outputAmts,
                inputAmts,
              });
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
    if (data.utxoInputs.length === 0) {
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
      grid: {
        top: 40,
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
          if (!ticks || ticks.length === 0) return '';
          let tooltip = `<b style="color: var(--fg); margin-left: 2px">${formatterXAxis(
            this.locale,
            this.timespan,
            parseInt(ticks[0].axisValue, 10)
          )}</b><br>`;

          for (const tick of ticks) {
            if (tick.seriesIndex === 0 || tick.seriesIndex === 1) {
              tooltip += `${tick.marker} ${tick.seriesName}: ${formatNumber(tick.data[1], this.locale, '1.2-2')} BCH`;
            } else {
              tooltip += `${tick.marker} ${tick.seriesName}: ${formatNumber(tick.data[1], this.locale, '1.0-0')}`;
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
      legend: {
        top: 0,
        data: [
          {
            name: $localize`Output Volume (BCH)`,
            inactiveColor: 'var(--grey)',
            textStyle: { color: 'var(--fg)' },
            icon: 'roundRect',
          },
          {
            name: $localize`Input Volume (BCH)`,
            inactiveColor: 'var(--grey)',
            textStyle: { color: 'var(--fg)' },
            icon: 'roundRect',
          },
          {
            name: $localize`UTXO Inputs`,
            inactiveColor: 'var(--grey)',
            textStyle: { color: 'var(--fg)' },
            icon: 'roundRect',
          },
          {
            name: $localize`UTXO Outputs`,
            inactiveColor: 'var(--grey)',
            textStyle: { color: 'var(--fg)' },
            icon: 'roundRect',
          },
        ],
        selected: JSON.parse(
          this.storageService?.getValue('block_volume_legend') || 'null'
        ) ?? {
          [$localize`Output Volume (BCH)`]: true,
          [$localize`Input Volume (BCH)`]: false,
          [$localize`UTXO Inputs`]: true,
          [$localize`UTXO Outputs`]: true,
        },
      },
      xAxis:
        data.utxoInputs.length === 0
          ? undefined
          : {
              type: 'time',
              splitNumber: this.isMobile() ? 5 : 10,
              axisLabel: {
                hideOverlap: true,
              },
            },
      yAxis:
        data.utxoInputs.length === 0
          ? undefined
          : [
              {
                type: 'value',
                position: 'left',
                min: 0,
                axisLabel: {
                  color: 'var(--grey)',
                  formatter: (val) => {
                    if (val >= 1e6) return (val / 1e6).toFixed(1) + 'M BCH';
                    if (val >= 1e3) return (val / 1e3).toFixed(1) + 'K BCH';
                    return val.toFixed(0) + ' BCH';
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
              {
                type: 'value',
                position: 'right',
                min: 0,
                axisLabel: {
                  color: 'var(--grey)',
                  formatter: (val: number) => val.toLocaleString(),
                },
                splitLine: { show: false },
              },
            ],
      series:
        data.utxoInputs.length === 0
          ? []
          : [
              {
                name: $localize`Output Volume (BCH)`,
                showSymbol: false,
                symbol: 'none',
                data: data.outputAmts,
                type: 'line',
                yAxisIndex: 0,
                lineStyle: { width: 1.5, color: '#648FFF' },
                itemStyle: { color: '#648FFF' },
                areaStyle: { color: '#648FFF', opacity: 0.25 },
              },
              {
                name: $localize`Input Volume (BCH)`,
                showSymbol: false,
                symbol: 'none',
                data: data.inputAmts,
                type: 'line',
                yAxisIndex: 0,
                lineStyle: { width: 1, color: '#785EF0' },
                itemStyle: { color: '#785EF0' },
                areaStyle: { color: '#785EF0', opacity: 0.25 },
              },
              {
                name: $localize`UTXO Inputs`,
                showSymbol: false,
                symbol: 'none',
                data: data.utxoInputs,
                type: 'line',
                yAxisIndex: 1,
                lineStyle: { width: 1, color: '#FFB000' },
                itemStyle: { color: '#FFB000' },
                areaStyle: { color: '#FFB000', opacity: 0.25 },
              },
              {
                name: $localize`UTXO Outputs`,
                showSymbol: false,
                symbol: 'none',
                data: data.utxoOutputs,
                type: 'line',
                yAxisIndex: 1,
                lineStyle: { width: 1, color: '#DC267F' },
                itemStyle: { color: '#DC267F' },
                areaStyle: { color: '#DC267F', opacity: 0.25 },
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
          'block_volume_legend',
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
      `block-volume-${this.timespan}-${Math.round(now.getTime() / 1000)}.svg`
    );
    // @ts-ignore
    this.chartOptions.grid.bottom = prevBottom;
    this.chartOptions.backgroundColor = 'none';
    this.chartInstance.setOption(this.chartOptions);
  }
}
