import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'limitTo',
  standalone: false,
})
export class LimitToPipe implements PipeTransform {
  transform(value: string, length: number): string {
    const limit = length ? length : 10;
    const trail = '…';

    return value.length > limit ? value.substring(0, limit) + trail : value;
  }
}
