import {
  Component,
  OnInit,
  ChangeDetectionStrategy,
  Input,
} from '@angular/core';
import { StateService } from '@app/services/state.service';
import { Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { MempoolInfo } from '@interfaces/websocket.interface';

interface MempoolBlocksData {
  blocks: number;
  size: number;
}

interface MempoolInfoData {
  memPoolInfo: MempoolInfo;
  bytesPerSecond: number;
}

@Component({
  selector: 'app-footer',
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterComponent implements OnInit {
  @Input() inline = false;

  mempoolBlocksData$: Observable<MempoolBlocksData>;
  mempoolInfoData$: Observable<MempoolInfoData>;
  isLoadingWebSocket$: Observable<boolean>;
  mempoolLoadingStatus$: Observable<number>;

  constructor(private stateService: StateService) {}

  ngOnInit() {
    this.isLoadingWebSocket$ = this.stateService.isLoadingWebSocket$;
    this.mempoolLoadingStatus$ = this.stateService.loadingIndicators$.pipe(
      map((indicators) =>
        indicators['mempool'] !== undefined ? indicators['mempool'] : 100
      )
    );

    this.mempoolInfoData$ = combineLatest([
      this.stateService.mempoolInfo$,
      this.stateService.bytesPerSecond$,
    ]).pipe(
      map(([mempoolInfo, bytesPerSecond]) => {
        return {
          memPoolInfo: mempoolInfo,
          bytesPerSecond: bytesPerSecond,
        };
      })
    );

    this.mempoolBlocksData$ = this.stateService.mempoolBlocks$.pipe(
      map((mempoolBlocks) => {
        const size = mempoolBlocks
          .map((m) => m.blockSize)
          .reduce((a, b) => a + b, 0);

        return {
          size: size,
          blocks: Math.ceil(size / this.stateService.blockSize),
        };
      })
    );
  }
}
