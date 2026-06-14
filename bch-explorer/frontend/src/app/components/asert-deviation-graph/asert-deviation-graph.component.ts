import {
  Component,
  Input,
  OnChanges,
  NgZone,
  ChangeDetectionStrategy,
  Output,
  EventEmitter,
  Inject,
  LOCALE_ID,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { EChartsOption } from '@app/graphs/echarts';

export interface AsertPoint {
  height: number;
  deviation: number; // seconds (positive = gaining on schedule, negative = falling behind)
  timestamp: number; // Unix timestamp in seconds
}

@Component({
  selector: 'app-asert-deviation-graph',
  templateUrl: './asert-deviation-graph.component.html',
  styleUrls: ['./asert-deviation-graph.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AsertDeviationGraphComponent implements OnChanges {
  @Input() data: AsertPoint[] = [];
  @Input() compressed = false;
  @Output() chartInit = new EventEmitter<any>();
  @Output() chartOptionsChange = new EventEmitter<EChartsOption>();

  chartOption: EChartsOption = {};
  initOpts = { renderer: 'svg' };

  private chartInstance: any;

  private get fontSize(): number {
    return this.compressed ? 9 : 12;
  }

  constructor(
    private zone: NgZone,
    @Inject(LOCALE_ID) public locale: string,
    private datePipe: DatePipe
  ) {}

  onChartInit(chart: any) {
    this.chartInstance = chart;
    this.chartInit.emit(chart);
    this.chartOptionsChange.emit(this.chartOption);
  }

  ngOnChanges() {
    if (this.data.length === 0) {
      return;
    }
    if (this.chartInstance) {
      this.updateChart();
    } else {
      this.buildChart();
    }
    this.chartOptionsChange.emit(this.chartOption);
  }

  private buildChart() {
    const heights = this.data.map((d) => d.height);
    const deviations = this.data.map((d) => d.deviation);

    // Calculate y-axis range for centering when not compressed
    let yAxisMin: number | undefined;
    let yAxisMax: number | undefined;
    if (!this.compressed) {
      const minDev = Math.min(...deviations);
      const maxDev = Math.max(...deviations);
      const maxAbs = Math.max(Math.abs(minDev), Math.abs(maxDev));
      // Add 10% padding for visual breathing room
      const padding = maxAbs * 0.1;
      const range = maxAbs + padding;
      yAxisMin = -range;
      yAxisMax = range;
    }

    // Add dataZoom when not compressed
    const dataZoom = !this.compressed
      ? [
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
                color: '#fff',
                opacity: 0.45,
              },
              areaStyle: {
                opacity: 0,
              },
            },
          },
        ]
      : undefined;

    this.chartOption = {
      grid: {
        left: 40,
        right: 12,
        top: 4,
        bottom: !this.compressed ? 80 : 4,
      },

      xAxis: {
        type: 'category',
        data: heights,
        name: 'Blocks',
        nameLocation: 'middle',
        nameGap: 4,
        nameTextStyle: {
          color: 'var(--transparent-fg)',
          fontSize: this.fontSize,
        },
        axisLabel: { show: !this.compressed },
        axisTick: { show: false },
        axisLine: {
          lineStyle: { color: 'var(--transparent-fg)', opacity: 0.2 },
        },
      },

      yAxis: {
        type: 'value',
        min: yAxisMin,
        max: yAxisMax,
        name: 'Δ schedule',
        nameLocation: 'middle',
        nameGap: 36,
        nameRotate: 90,
        nameTextStyle: {
          color: 'var(--transparent-fg)',
          fontSize: this.fontSize,
        },
        axisLabel: {
          formatter: (v: number) => this.formatAxisLabel(v),
          color: 'var(--transparent-fg)',
          fontSize: this.fontSize,
        },
        splitLine: {
          lineStyle: { color: 'var(--transparent-fg)', opacity: 0.08 },
        },
      },

      tooltip: {
        trigger: 'axis',
        backgroundColor: 'var(--bg)',
        borderColor: 'var(--transparent-fg)',
        textStyle: {
          color: 'var(--fg)',
          fontSize: 12,
        },
        formatter: (params: any) => {
          if (!params || !params[0]) {
            return '';
          }
          const idx = params[0].dataIndex;
          const dev = deviations[idx];
          const absDev = Math.abs(dev);
          const timestamp = this.data[idx].timestamp;
          const date = new Date(timestamp * 1000);
          const formattedDate = this.datePipe.transform(
            date,
            'medium',
            this.locale
          );
          const state =
            dev > 0
              ? '<span style="color:#ef4444">Gaining on schedule → difficulty increasing</span>'
              : dev < 0
                ? '<span style="color:#3b82f6">Falling behind → difficulty decreasing</span>'
                : 'On schedule';
          return `
            <strong>Block ${heights[idx]}</strong><br/>
            ${formattedDate}<br/>
            Deviation: ${dev >= 0 ? '+' : ''}${dev}s (${this.formatDuration(absDev)})<br/>
            ${state}
          `;
        },
      },

      series: [
        {
          name: 'Deviation',
          type: 'line',
          data: deviations,
          smooth: true,
          symbol: 'none',
          lineStyle: {
            width: 2,
            color: this.buildGradient(deviations, '#ef4444', '#3b82f6', 1),
          },
          areaStyle: {
            color: this.buildGradient(
              deviations,
              'rgba(239,68,68,0.25)',
              'rgba(59,130,246,0.25)',
              0
            ),
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: {
              type: 'dashed',
              opacity: 0.35,
              color: 'var(--transparent-fg)',
            },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
        },
      ],

      dataZoom: dataZoom,

      animationDuration: 300,
      animationDurationUpdate: 400,
      animationEasingUpdate: 'cubicInOut',
    };
  }

  private updateChart() {
    this.buildChart();
    this.zone.runOutsideAngular(() => {
      this.chartInstance.setOption(this.chartOption);
    });
  }

  /**
   * Build a vertical linear gradient that transitions from `aboveColor` (top)
   * through transparent at the zero-line to `belowColor` (bottom).
   * `zeroAlpha` controls the midpoint opacity (0 = fully transparent).
   */
  private buildGradient(
    deviations: number[],
    aboveColor: string,
    belowColor: string,
    zeroAlpha: number
  ): any {
    const minDev = Math.min(...deviations);
    const maxDev = Math.max(...deviations);
    const range = maxDev - minDev;

    // Position of zero in gradient space (0 = top/max, 1 = bottom/min)
    const zeroOffset =
      range > 0 ? Math.max(0.01, Math.min(0.99, maxDev / range)) : 0.5;

    const midColor = `rgba(128,128,128,${zeroAlpha})`;

    return {
      type: 'linear',
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: aboveColor },
        { offset: zeroOffset, color: midColor },
        { offset: 1, color: belowColor },
      ],
    };
  }

  private formatAxisLabel(v: number): string {
    const abs = Math.abs(v);
    const sign = v > 0 ? '+' : '';

    if (abs < 60) {
      return `${sign}${v}s`;
    }
    const mins = Math.round(v / 60);
    if (abs / 60 < 60) {
      return `${sign}${mins}m`;
    }
    const hours = v / 3600;
    if (abs / 3600 < 24) {
      // Use decimal precision to avoid duplicate labels (e.g., 1.5h, 2h, 2.5h)
      const roundedHours = Math.round(hours * 10) / 10;
      return `${sign}${roundedHours}h`;
    }
    const days = hours / 24;
    const roundedDays = Math.round(days * 10) / 10;
    return `${sign}${roundedDays}d`;
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) {
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    }
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    if (hours < 24) {
      return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    const remainHours = hours % 24;
    return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
  }
}
