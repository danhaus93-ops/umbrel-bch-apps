import {
  Component,
  ChangeDetectionStrategy,
  OnChanges,
  Input,
} from '@angular/core';
import { Transaction, Vin, Vout } from '@app/interfaces/backend-api.interface';

@Component({
  selector: 'app-tx-features',
  templateUrl: './tx-features.component.html',
  styleUrls: ['./tx-features.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TxFeaturesComponent implements OnChanges {
  @Input() tx: Transaction;

  isCheap: boolean;
  hasCashToken: boolean;

  ngOnChanges() {
    if (!this.tx) {
      return;
    }
    this.isCheap = this.tx.feePerSize < 10.0;
    this.hasCashToken =
      this.tx.vin.some((v: Vin) => v.token_category) ||
      this.tx.vout.some((v: Vout) => v.token_category);
  }
}
