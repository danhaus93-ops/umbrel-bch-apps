import { ChangeDetectionStrategy, Component } from '@angular/core';
import { StorageService } from '@app/services/storage.service';
import { StateService } from '@app/services/state.service';

@Component({
  selector: 'app-notification',
  templateUrl: './notification.component.html',
  styleUrls: ['./notification.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationComponent {
  constructor(
    public storageService: StorageService,
    public stateService: StateService
  ) {}

  dismissNotification(): void {
    this.storageService.setValue('hideNotification', 'hidden');
  }
}
