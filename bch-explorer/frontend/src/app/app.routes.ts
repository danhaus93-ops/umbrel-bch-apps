import { Routes } from '@angular/router';
import { BlockViewComponent } from '@components/block-view/block-view.component';
import { EightBlocksComponent } from '@components/eight-blocks/eight-blocks.component';
import { MempoolBlockViewComponent } from '@components/mempool-block-view/mempool-block-view.component';
import { ClockComponent } from '@components/clock/clock.component';
import { StatusViewComponent } from '@components/status-view/status-view.component';
import { AddressGroupComponent } from '@components/address-group/address-group.component';
import { TrackerGuard } from '@app/route-guards';

export const routes: Routes = [
  {
    path: 'scalenet',
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadChildren: () =>
          import('@app/bitcoin-graphs.module').then(
            (m) => m.BitcoinGraphsModule
          ),
        data: { preload: true },
      },
      {
        path: '',
        loadChildren: () =>
          import('@app/master-page.module').then(
            (m) => m.MasterPageRoutingModule
          ),
        data: { preload: true },
      },
      {
        path: 'widget/wallet',
        children: [],
        component: AddressGroupComponent,
        data: {
          networkSpecific: true,
        },
      },
      {
        path: 'status',
        data: { networks: ['bitcoin'] },
        component: StatusViewComponent,
      },
      {
        path: '',
        loadChildren: () =>
          import('@app/bitcoin-graphs.module').then(
            (m) => m.BitcoinGraphsModule
          ),
        data: { preload: true },
      },
      {
        path: '**',
        redirectTo: '/scalenet',
      },
    ],
  },
  {
    path: 'testnet4',
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadChildren: () =>
          import('@app/bitcoin-graphs.module').then(
            (m) => m.BitcoinGraphsModule
          ),
        data: { preload: true },
      },
      {
        path: '',
        loadChildren: () =>
          import('@app/master-page.module').then(
            (m) => m.MasterPageRoutingModule
          ),
        data: { preload: true },
      },
      {
        path: 'wallet',
        children: [],
        component: AddressGroupComponent,
        data: {
          networkSpecific: true,
        },
      },
      {
        path: 'status',
        data: { networks: ['bitcoin'] },
        component: StatusViewComponent,
      },
      {
        path: '',
        loadChildren: () =>
          import('@app/bitcoin-graphs.module').then(
            (m) => m.BitcoinGraphsModule
          ),
        data: { preload: true },
      },
      {
        path: '**',
        redirectTo: '/testnet4',
      },
    ],
  },
  {
    path: 'chipnet',
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadChildren: () =>
          import('@app/bitcoin-graphs.module').then(
            (m) => m.BitcoinGraphsModule
          ),
        data: { preload: true },
      },
      {
        path: '',
        loadChildren: () =>
          import('@app/master-page.module').then(
            (m) => m.MasterPageRoutingModule
          ),
        data: { preload: true },
      },
      {
        path: 'widget/wallet',
        children: [],
        component: AddressGroupComponent,
        data: {
          networkSpecific: true,
        },
      },
      {
        path: 'status',
        data: { networks: ['bitcoin'] },
        component: StatusViewComponent,
      },
      {
        path: '',
        loadChildren: () =>
          import('@app/bitcoin-graphs.module').then(
            (m) => m.BitcoinGraphsModule
          ),
        data: { preload: true },
      },
      {
        path: '**',
        redirectTo: '/chipnet',
      },
    ],
  },
  {
    path: '',
    pathMatch: 'full',
    loadChildren: () =>
      import('@app/bitcoin-graphs.module').then((m) => m.BitcoinGraphsModule),
    data: { preload: true },
  },
  // I don't like the tracker component (on mobile)
  // {
  //   path: 'tx',
  //   canMatch: [TrackerGuard],
  //   runGuardsAndResolvers: 'always',
  //   loadChildren: () =>
  //     import('@components/tracker/tracker.module').then((m) => m.TrackerModule),
  // },
  {
    path: '',
    loadChildren: () =>
      import('@app/master-page.module').then((m) => m.MasterPageRoutingModule),
    data: { preload: true },
  },
  {
    path: 'widget/wallet',
    children: [],
    component: AddressGroupComponent,
    data: {
      networkSpecific: true,
    },
  },
  {
    path: 'preview',
    children: [
      {
        path: '',
        loadChildren: () =>
          import('@app/previews.module').then((m) => m.PreviewsModule),
      },
      {
        path: 'testnet4',
        loadChildren: () =>
          import('@app/previews.module').then((m) => m.PreviewsModule),
      },
      {
        path: 'scalenet',
        loadChildren: () =>
          import('@app/previews.module').then((m) => m.PreviewsModule),
      },
      {
        path: 'chipnet',
        loadChildren: () =>
          import('@app/previews.module').then((m) => m.PreviewsModule),
      },
    ],
  },
  {
    path: 'clock',
    redirectTo: 'clock/mempool/0',
  },
  {
    path: 'clock/:mode',
    redirectTo: 'clock/:mode/0',
  },
  {
    path: 'clock/:mode/:index',
    component: ClockComponent,
  },
  {
    path: 'view/block/:id',
    component: BlockViewComponent,
  },
  {
    path: 'view/mempool-block/:index',
    component: MempoolBlockViewComponent,
  },
  {
    path: 'view/blocks',
    component: EightBlocksComponent,
  },
  {
    path: 'status',
    data: { networks: ['bitcoin'] },
    component: StatusViewComponent,
  },
  {
    path: '',
    loadChildren: () =>
      import('@app/bitcoin-graphs.module').then((m) => m.BitcoinGraphsModule),
    data: { preload: true },
  },
  {
    path: '**',
    redirectTo: '',
  },
];
