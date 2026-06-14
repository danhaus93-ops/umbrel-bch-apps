import { BrowserModule } from '@angular/platform-browser';
import { ModuleWithProviders, NgModule } from '@angular/core';
import {
  HTTP_INTERCEPTORS,
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { RouterModule } from '@angular/router';
import { ZONE_SERVICE } from '@app/injection-tokens';
import { App } from '@app/app';
import { ElectrsApiService } from '@app/services/backend-api.service';
import { StateService } from '@app/services/state.service';
import { CacheService } from '@app/services/cache.service';
import { PriceService } from '@app/services/price.service';
import { EnterpriseService } from '@app/services/enterprise.service';
import { WebsocketService } from '@app/services/websocket.service';
import { AudioService } from '@app/services/audio.service';
import { PreloadService } from '@app/services/preload.service';
import { SeoService } from '@app/services/seo.service';
import { OpenGraphService } from '@app/services/opengraph.service';
import { ZoneService } from '@app/services/zone-shim.service';
import { SharedModule } from '@app/shared/shared.module';
import { StorageService } from '@app/services/storage.service';
import { HttpCacheInterceptor } from '@app/services/http-cache.interceptor';
import { LanguageService } from '@app/services/language.service';
import { ThemeService } from '@app/services/theme.service';
import { TimeService } from '@app/services/time.service';
import { FiatShortenerPipe } from '@app/shared/pipes/fiat-shortener.pipe';
import { FiatCurrencyPipe } from '@app/shared/pipes/fiat-currency.pipe';
import { LimitToPipe } from '@app/shared/pipes/limit-to-pipe/limit-to.pipe';
import { ShortenStringPipe } from '@app/shared/pipes/shorten-string-pipe/shorten-string.pipe';
import { CapAddressPipe } from '@app/shared/pipes/cap-address-pipe/cap-address-pipe';
import { AppPreloadingStrategy } from '@app/app.preloading-strategy';
import { ServicesApiServices } from '@app/services/services-api.service';
import { DatePipe } from '@angular/common';
import { routes } from '@app/app.routes';

const providers = [
  ElectrsApiService,
  StateService,
  CacheService,
  PriceService,
  WebsocketService,
  AudioService,
  SeoService,
  OpenGraphService,
  StorageService,
  EnterpriseService,
  LanguageService,
  ThemeService,
  TimeService,
  LimitToPipe,
  ShortenStringPipe,
  FiatShortenerPipe,
  FiatCurrencyPipe,
  CapAddressPipe,
  AppPreloadingStrategy,
  ServicesApiServices,
  PreloadService,
  { provide: HTTP_INTERCEPTORS, useClass: HttpCacheInterceptor, multi: true },
  { provide: ZONE_SERVICE, useClass: ZoneService },
];

@NgModule({
  declarations: [App],
  bootstrap: [App],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    SharedModule,
    RouterModule.forRoot(routes, {
      initialNavigation: 'enabledNonBlocking',
      scrollPositionRestoration: 'enabled',
      anchorScrolling: 'enabled',
      preloadingStrategy: AppPreloadingStrategy,
    }),
  ],
  providers: [
    provideHttpClient(withInterceptorsFromDi()),
    DatePipe,
    ...providers,
  ],
})
export class AppModule {}

@NgModule({})
export class MempoolSharedModule {
  static forRoot(): ModuleWithProviders<MempoolSharedModule> {
    return {
      ngModule: AppModule,
      providers: providers,
    };
  }
}
