import { Component, Input } from '@angular/core';
import { BcmrMetadata } from '@app/interfaces/bcmr-api.interface';

@Component({
  selector: 'app-token-icon-and-text',
  templateUrl: './token-icon-and-text.component.html',
  styleUrls: ['./token-icon-and-text.component.scss'],
  standalone: false,
})
export class TokenIconAndTextComponent {
  @Input() metadata: BcmrMetadata | undefined;
  @Input() category: string | null;

  private readonly IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

  resolveIconUrl(icon?: string): string | null {
    if (!icon) return null;
    if (icon.startsWith('ipfs://')) {
      return this.IPFS_GATEWAY + icon.slice('ipfs://'.length);
    }
    return icon; // http(s) already fine
  }
}
