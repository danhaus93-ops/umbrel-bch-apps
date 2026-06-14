/// <reference types="@angular/localize" />

import { provideZoneChangeDetection } from '@angular/core';
import { BootstrapContext } from '@angular/platform-browser';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';

const bootstrap = (context: BootstrapContext) =>
  platformBrowserDynamic().bootstrapModule(AppModule, {
    applicationProviders: [provideZoneChangeDetection()],
  });

export default bootstrap;
