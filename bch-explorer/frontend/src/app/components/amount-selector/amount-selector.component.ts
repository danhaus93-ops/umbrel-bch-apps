import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup } from '@angular/forms';
import { StorageService } from '@app/services/storage.service';
import { StateService } from '@app/services/state.service';

@Component({
  selector: 'app-amount-selector',
  templateUrl: './amount-selector.component.html',
  styleUrls: ['./amount-selector.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AmountSelectorComponent implements OnInit {
  amountForm: UntypedFormGroup;
  amountModes = ['bch', 'sats', 'fiat'];

  constructor(
    private formBuilder: UntypedFormBuilder,
    private stateService: StateService,
    private storageService: StorageService
  ) {}

  ngOnInit() {
    this.amountForm = this.formBuilder.group({
      amountMode: ['bch'],
    });
    this.stateService.viewAmountMode$.subscribe((amountMode) => {
      this.amountForm.get('amountMode')?.setValue(amountMode);
    });
  }

  changeAmountMode() {
    const newAmountMode = this.amountForm.get('amountMode')?.value;
    this.storageService.setValue('view-amount-mode', newAmountMode);
    this.stateService.viewAmountMode$.next(newAmountMode);
  }
}
