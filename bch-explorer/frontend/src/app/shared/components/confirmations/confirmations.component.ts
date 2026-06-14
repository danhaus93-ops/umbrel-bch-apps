import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
} from '@angular/core';

@Component({
  selector: 'app-confirmations',
  templateUrl: './confirmations.component.html',
  styleUrls: ['./confirmations.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmationsComponent implements OnChanges {
  @Input() chainTip: number;
  @Input() height: number;
  @Input() confirmed: boolean = false;
  @Input() buttonClass: string = '';
  @Input() blockHash: string;

  confirmations: number = 0;
  tooltipText: string = 'Go to block';

  ngOnChanges(): void {
    if (this.chainTip != null && this.height != null) {
      this.confirmations = Math.max(1, this.chainTip - this.height + 1);
    } else {
      this.confirmations = 0;
    }
    this.tooltipText =
      this.height != null ? `Go to block ${this.height}` : 'Go to block';
  }
}
