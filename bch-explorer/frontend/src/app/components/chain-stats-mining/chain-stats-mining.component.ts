import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnInit,
} from '@angular/core';
import { combineLatest, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';
import { getDifficultyDriftPercentSinceAnchor } from '@app/shared/asert.utils';

interface AsertMiningStatus {
  difficultyDriftPercent: number;
  colorDrift: string;
  diffChangePercent: number;
  diffChangeBlocks: number;
  colorDiffChange: string;
  blocksUntilHalving: number;
  timeUntilHalving: number;
  timeAvg: number;
}

@Component({
  selector: 'app-chain-stats-mining',
  templateUrl: './chain-stats-mining.component.html',
  styleUrls: ['./chain-stats-mining.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainStatsMiningComponent implements OnInit {
  isLoadingWebSocket$: Observable<boolean>;
  asertStatus$: Observable<AsertMiningStatus>;
  blocksUntilHalving: number | null = null;
  timeUntilHalving = 0;
  now = new Date().getTime();

  @Input() showProgress = true;
  @Input() showHalving = false;
  @Input() showTitle = true;

  constructor(public stateService: StateService) {}

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

        const difficultyDriftPercentSinceAnchor =
          getDifficultyDriftPercentSinceAnchor(
            latestBlock.height,
            latestBlock.timestamp,
            this.stateService.network
          );

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

        this.blocksUntilHalving = 210000 - (maxHeight % 210000);
        this.timeUntilHalving =
          new Date().getTime() + this.blocksUntilHalving * 600000;
        this.now = new Date().getTime();

        return {
          difficultyDriftPercent: difficultyDriftPercentSinceAnchor,
          colorDrift,
          diffChangePercent,
          diffChangeBlocks,
          colorDiffChange,
          blocksUntilHalving: this.blocksUntilHalving,
          timeUntilHalving: this.timeUntilHalving,
          timeAvg: da.timeAvg,
        };
      })
    );
  }

  isEllipsisActive(e): boolean {
    return e.offsetWidth < e.scrollWidth;
  }
}
