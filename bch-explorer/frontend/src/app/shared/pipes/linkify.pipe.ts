import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({ name: 'linkify', standalone: false })
export class LinkifyPipe implements PipeTransform {
  constructor(private domSanitizer: DomSanitizer) {}

  transform(text: string): SafeHtml {
    if (!text) return '';
    const linked = text.replace(
      /https?:\/\/[^\s)]+/g,
      (url) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
    );
    return this.domSanitizer.bypassSecurityTrustHtml(linked);
  }
}
