import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  Input,
  LOCALE_ID,
  OnInit,
} from '@angular/core';
import { combineLatest, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  getScheduleOffsetSeconds,
  getDifficultyDriftPercentSinceAnchor,
  getAsertAnchorHeight,
  getAsertAnchor,
} from '@app/shared/asert.utils';
import { StateService } from '@app/services/state.service';
import { AsertPoint } from '@app/components/asert-deviation-graph/asert-deviation-graph.component';

interface AsertStatus {
  difficultyDriftPercent: number;
  colorDrift: string;
  timeAvg: number;
  blocksUntilHalving: number;
  timeUntilHalving: number;
  diffChangePercent: number;
  diffChangeBlocks: number;
  colorDiffChange: string;
}

@Component({
  selector: 'app-difficulty',
  templateUrl: './difficulty.component.html',
  styleUrls: ['./difficulty.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DifficultyComponent implements OnInit {
  @Input() showProgress = true;
  @Input() showHalving = false;
  @Input() showTitle = true;

  isLoadingWebSocket$: Observable<boolean>;
  asertStatus$: Observable<AsertStatus>;

  mode: 'difficulty' | 'halving' = 'difficulty';
  userSelectedMode: boolean = false;

  now: number = Date.now();
  nextSubsidy: number;
  asertData: AsertPoint[] = [];
  private asertRawData: AsertPoint[] = [];

  get asertAnchorHeight(): number {
    return getAsertAnchorHeight(this.stateService.network);
  }

  get asertAnchorTimestamp(): number {
    return getAsertAnchor(this.stateService.network).timestamp;
  }

  constructor(
    public stateService: StateService,
    @Inject(LOCALE_ID) private locale: string
  ) {}

  ngOnInit(): void {
    this.isLoadingWebSocket$ = this.stateService.isLoadingWebSocket$;
    this.asertStatus$ = combineLatest([
      this.stateService.blocks$,
      this.stateService.difficultyAdjustment$,
    ]).pipe(
      map(([blocks, da]) => {
        const maxHeight = blocks.reduce(
          (max, block) => Math.max(max, block.height),
          0
        );
        const latestBlock = blocks.reduce(
          (latest, block) => (block.height > latest.height ? block : latest),
          blocks[0]
        );

        this.now = new Date().getTime();
        this.nextSubsidy = getNextBlockSubsidy(maxHeight);

        // Halving
        const blocksUntilHalving = 210000 - (maxHeight % 210000);
        const timeUntilHalving =
          new Date().getTime() + blocksUntilHalving * 600000;

        // ASERT difficulty drift %
        const difficultyDriftPercentSinceAnchor =
          getDifficultyDriftPercentSinceAnchor(
            latestBlock.height,
            latestBlock.timestamp,
            this.stateService.network
          );

        // Color for drift indicator
        let colorDrift = 'var(--transparent-fg)';
        if (difficultyDriftPercentSinceAnchor > 0.001) {
          colorDrift = 'var(--green)';
        } else if (difficultyDriftPercentSinceAnchor < -0.001) {
          colorDrift = 'var(--red)';
        }

        // Difficulty change over visible blocks
        const sorted = [...blocks].sort((a, b) => a.height - b.height);
        const oldestBlock = sorted[0];
        const diffChangeBlocks = sorted.length;
        let diffChangePercent = 0;
        if (oldestBlock && oldestBlock.difficulty > 0) {
          diffChangePercent =
            ((latestBlock.difficulty - oldestBlock.difficulty) /
              oldestBlock.difficulty) *
            100;
        }
        let colorDiffChange = 'var(--transparent-fg)';
        if (diffChangePercent > 0.001) {
          colorDiffChange = 'var(--green)';
        } else if (diffChangePercent < -0.001) {
          colorDiffChange = 'var(--red)';
        }

        // Build ASERT deviation points from all known blocks (relative to baseline)
        const absolutePoints = sorted.map((block) => ({
          height: block.height,
          deviation: getScheduleOffsetSeconds(
            block.height,
            block.timestamp,
            this.stateService.network
          ),
          timestamp: block.timestamp,
        }));
        // Merge new points into raw rolling window (absolute values), dedup by height
        this.asertRawData = [
          ...this.asertRawData,
          ...absolutePoints.filter(
            (p) => !this.asertRawData.some((e) => e.height === p.height)
          ),
        ]
          .sort((a, b) => a.height - b.height)
          .slice(-100);
        // Normalize: subtract first point's deviation so chart centers at 0
        const baseline =
          this.asertRawData.length > 0 ? this.asertRawData[0].deviation : 0;
        this.asertData = this.asertRawData.map((p) => ({
          height: p.height,
          deviation: p.deviation - baseline,
          timestamp: p.timestamp,
        }));

        if (!this.userSelectedMode) {
          this.mode = 'difficulty';
        }

        return {
          difficultyDriftPercent: difficultyDriftPercentSinceAnchor,
          colorDrift,
          timeAvg: da.timeAvg,
          blocksUntilHalving,
          timeUntilHalving,
          diffChangePercent,
          diffChangeBlocks,
          colorDiffChange,
        };
      })
    );
  }

  setMode(mode: 'difficulty' | 'halving'): boolean {
    this.mode = mode;
    this.userSelectedMode = true;
    return false;
  }
}

function getNextBlockSubsidy(height: number): number {
  const halvings = Math.floor(height / 210_000) + 1;
  // Force block reward to zero when right shift is undefined.
  if (halvings >= 64) {
    return 0;
  }

  let subsidy = BigInt(50 * 100_000_000);
  // Subsidy is cut in half every 210,000 blocks which will occur approximately every 4 years.
  subsidy >>= BigInt(halvings);
  return Number(subsidy);
}
