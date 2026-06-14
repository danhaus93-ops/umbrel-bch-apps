import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { specialBlocks } from '@app/app.constants';

interface SpecialBlock {
  height: number;
  labelEvent: string;
  labelEventCompleted: string;
  networks: string[];
}

@Component({
  selector: 'app-special-blocks',
  templateUrl: './special-blocks.component.html',
  styleUrls: ['./special-blocks.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpecialBlocksComponent implements OnInit {
  blocks: SpecialBlock[] = [];

  constructor(
    public stateService: StateService,
    private seoService: SeoService,
    public router: Router
  ) {}

  ngOnInit(): void {
    this.seoService.setTitle($localize`Special Blocks`);
    this.seoService.setDescription(
      $localize`Significant Bitcoin Cash blocks, including halvings, hard forks, protocol upgrades, and other milestones — past and future.`
    );

    const activeNetwork = this.getActiveNetworkKey();

    this.blocks = Object.entries(specialBlocks)
      .filter(([_, data]) => data.networks.includes(activeNetwork))
      .map(([height, data]) => ({
        height: parseInt(height, 10),
        labelEvent: data.labelEvent,
        labelEventCompleted: data.labelEventCompleted,
        networks: data.networks,
      }))
      .sort((a, b) => a.height - b.height);
  }

  getActiveNetworkKey(): string {
    if (this.stateService.env.ROOT_NETWORK === 'chipnet') {
      return 'chipnet';
    }
    if (this.stateService.network === 'testnet4') {
      return 'testnet4';
    }
    return 'mainnet';
  }
}
