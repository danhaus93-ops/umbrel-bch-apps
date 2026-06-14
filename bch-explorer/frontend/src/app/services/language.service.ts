import { DOCUMENT } from '@angular/common';
import { LOCALE_ID, Inject, Injectable } from '@angular/core';
import { languages } from '@app/app.constants';

@Injectable({
  providedIn: 'root',
})
export class LanguageService {
  private language = 'en';
  private languages = languages;
  constructor(
    @Inject(DOCUMENT) private document: Document,
    @Inject(LOCALE_ID) private locale: string
  ) {
    const localeId = this.locale ?? 'en';
    this.language = localeId;
    this.language = languages.find((l) => l.code === localeId) // Try to use full locale (e.g., en-US, zh-Hant)
      ? localeId
      : new Intl.Locale(localeId).language; // Fallback to language code (e.g., zh)
  }

  getLanguage(): string {
    return this.language;
  }

  stripLanguageFromUrl(urlPath: string) {
    let rawUrlPath = urlPath ? urlPath : document.location.pathname;
    const urlLanguage = this.document.location.pathname.split('/')[1];
    if (this.languages.map((lang) => lang.code).indexOf(urlLanguage) != -1) {
      rawUrlPath = rawUrlPath.substring(urlLanguage.length + 1);
    }
    return rawUrlPath;
  }

  getLanguageForUrl(): string {
    return this.language === 'en' ? '' : '/' + this.language;
  }

  setLanguage(language: string): void {
    try {
      document.cookie = `lang=${language}; expires=Thu, 18 Dec 2050 12:00:00 UTC; path=/`;
    } catch (e) {}
  }
}
