import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'hex2ascii',
  standalone: false,
})
export class Hex2asciiPipe implements PipeTransform {
  transform(hex: string): string {
    if (!hex) {
      return '';
    }
    const tokens = hex.split(' ');
    const opPush = tokens.filter(
      (_, i, a) => i > 0 && /^OP_PUSH/.test(a[i - 1])
    );

    if (opPush.length > 0) {
      return opPush.map((h) => this.hexToAscii(h)).join(' ');
    }

    return this.hexToAscii(hex);
  }

  private hexToAscii(hex: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return new TextDecoder('utf8')
      .decode(Uint8Array.from(bytes))
      .replace(/\uFFFD/g, '')
      .replace(/\\0/g, '');
  }
}
