import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { Observable } from 'rxjs';
import { MempoolInfo } from '@interfaces/websocket.interface';

interface MempoolInfoData {
  memPoolInfo: MempoolInfo;
  bytesPerSecond: number;
}

@Component({
  selector: 'app-mempool-progress-bar',
  templateUrl: './mempool-progress-bar.component.html',
  styleUrls: ['./mempool-progress-bar.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MempoolProgressBarComponent {
  @Input() mempoolLoadingStatus$: Observable<number> | undefined;
  @Input() mempoolInfoData: MempoolInfoData | undefined;
  @Input() isLoadingWebSocket$: Observable<boolean> | undefined;

  bytesPerSecondLimit = 4000;

  getProgressWidth(): string {
    if (!this.mempoolInfoData) return '0%';
    const percent = Math.round(
      (Math.min(this.mempoolInfoData.bytesPerSecond, this.bytesPerSecondLimit) /
        this.bytesPerSecondLimit) *
        100
    );

    return percent + '%';
  }

  getProgressColor(): string {
    if (!this.mempoolInfoData) return '#7CB342';

    const bytesPerSecond = this.mempoolInfoData.bytesPerSecond;
    let progressColor = '#7CB342';

    if (bytesPerSecond > 1667) {
      progressColor = '#FDD835';
    }
    if (bytesPerSecond > 2000) {
      progressColor = '#FFB300';
    }
    if (bytesPerSecond > 2500) {
      progressColor = '#FB8C00';
    }
    if (bytesPerSecond > 3000) {
      progressColor = '#F4511E';
    }
    if (bytesPerSecond > 3500) {
      progressColor = '#D81B60';
    }

    return progressColor;
  }
}
