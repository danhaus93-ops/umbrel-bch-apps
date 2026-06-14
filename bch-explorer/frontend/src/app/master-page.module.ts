import { NgModule } from '@angular/core';
import {
  Routes,
  RouterModule,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { StartComponent } from '@components/start/start.component';
import { PushTransactionComponent } from '@components/push-transaction/push-transaction.component';
import { TestTransactionsComponent } from '@components/test-transactions/test-transactions.component';
import { CalculatorComponent } from '@components/calculator/calculator.component';
import { BlocksList } from '@components/blocks-list/blocks-list.component';
import { RecentTransactionsList } from '@components/recent-transactions-list/recent-transactions-list.component';
import { SpecialBlocksComponent } from '@components/special-blocks/special-blocks.component';
import { StaleList } from '@components/stale-list/stale-list.component';
import { StratumList } from '@components/stratum/stratum-list/stratum-list.component';
import { ServerHealthComponent } from '@components/server-health/server-health.component';
import { ServerStatusComponent } from '@components/server-health/server-status.component';
import { FaucetComponent } from '@components/faucet/faucet.component';
import { SimpleProofWidgetComponent } from '@components/simpleproof-widget/simpleproof-widget.component';
import { SimpleProofCuboWidgetComponent } from '@components/simpleproof-widget/simpleproof-cubo-widget.component';
import { VerifyAddressComponent } from '@components/verify-address/verify-address.component';
import { AddressConverterComponent } from '@components/address-converter/address-converter.component';

const browserWindow = window || {};
// @ts-ignore
const browserWindowEnv = browserWindow.__env || {};

const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('@components/master-page/master-page.component').then(
        (m) => m.MasterPageComponent
      ),
    children: [
      {
        path: 'mining/blocks',
        redirectTo: 'blocks',
        pathMatch: 'full',
      },
      {
        path: 'tx/push',
        component: PushTransactionComponent,
      },
      {
        path: 'pushtx',
        component: PushTransactionComponent,
      },
      {
        path: 'tx/test',
        component: TestTransactionsComponent,
      },
      {
        path: 'about',
        loadChildren: () =>
          import('@components/about/about.module').then((m) => m.AboutModule),
      },
      {
        path: 'blocks/stale',
        component: StaleList,
      },
      {
        path: 'blocks/special',
        component: SpecialBlocksComponent,
      },
      {
        path: 'blocks/:page',
        component: BlocksList,
      },
      {
        path: 'blocks',
        redirectTo: 'blocks/1',
      },
      {
        path: 'txs',
        component: RecentTransactionsList,
      },
      ...(browserWindowEnv.STRATUM_ENABLED
        ? [
            {
              path: 'stratum',
              component: StartComponent,
              children: [
                {
                  path: '',
                  component: StratumList,
                },
              ],
            },
          ]
        : []),
      {
        path: 'terms-of-service',
        loadChildren: () =>
          import('@components/terms-of-service/terms-of-service.module').then(
            (m) => m.TermsOfServiceModule
          ),
      },
      {
        path: 'privacy-policy',
        loadChildren: () =>
          import('@components/privacy-policy/privacy-policy.module').then(
            (m) => m.PrivacyPolicyModule
          ),
      },
      {
        path: 'tx',
        component: StartComponent,
        data: { preload: true, networkSpecific: true },
        loadChildren: () =>
          import('@components/transaction/transaction.module').then(
            (m) => m.TransactionModule
          ),
      },
      {
        path: 'block',
        component: StartComponent,
        data: { preload: true, networkSpecific: true },
        loadChildren: () =>
          import('@components/block/block.module').then((m) => m.BlockModule),
      },
      {
        path: 'docs',
        loadChildren: () =>
          import('@app/docs/docs.module').then((m) => m.DocsModule),
        data: { preload: true },
      },
      {
        path: 'api',
        loadChildren: () =>
          import('@app/docs/docs.module').then((m) => m.DocsModule),
      },
      {
        path: 'tools/calculator',
        component: CalculatorComponent,
      },
      {
        path: 'tools/address-converter',
        component: AddressConverterComponent,
      },
      {
        path: 'verify',
        component: VerifyAddressComponent,
      },
      {
        path: 'monitoring',
        data: { networks: ['bitcoin'] },
        component: ServerHealthComponent,
      },
      {
        path: 'nodes',
        data: { networks: ['bitcoin'] },
        component: ServerStatusComponent,
      },
    ],
  },
];

if (window['isOfficialSiteBuild']) {
  routes[0].children.push({
    path: 'faucet',
    canActivate: [
      (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
        return state.url.startsWith('/testnet4/');
      },
    ],
    component: StartComponent,
    data: { preload: true, networkSpecific: true },
    children: [
      {
        path: '',
        data: { networks: ['bitcoin'] },
        component: FaucetComponent,
      },
    ],
  });
}

if (
  window['__env']?.customize?.dashboard?.widgets?.some(
    (w) => w.component === 'simpleproof'
  )
) {
  routes[0].children.push({
    path: 'sp/verified',
    component: SimpleProofWidgetComponent,
  });
}

if (
  window['__env']?.customize?.dashboard?.widgets?.some(
    (w) => w.component === 'simpleproof_cubo'
  )
) {
  routes[0].children.push({
    path: 'sp/cubo',
    component: SimpleProofCuboWidgetComponent,
  });
}

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class MasterPageRoutingModule {}
