import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { BlockHealthGraphComponent } from '@components/block-health-graph/block-health-graph.component';
import { BlockFeeRatesGraphComponent } from '@components/block-fee-rates-graph/block-fee-rates-graph.component';
import { BlockFeesGraphComponent } from '@components/block-fees-graph/block-fees-graph.component';
import { BlockFeesSubsidyGraphComponent } from '@components/block-fees-subsidy-graph/block-fees-subsidy-graph.component';
import { BlockRewardsGraphComponent } from '@components/block-rewards-graph/block-rewards-graph.component';
import { PriceChartComponent } from '@components/price-chart/price-chart.component';
import { BlockSizesGraphComponent } from '@components/block-sizes-graph/block-sizes-graph.component';
import { BlockTimesGraphComponent } from '@components/block-times-graph/block-times-graph.component';
import { GraphsComponent } from '@components/graphs/graphs.component';
import { HashrateChartComponent } from '@components/hashrate-chart/hashrate-chart.component';
import { HashrateChartPoolsComponent } from '@components/hashrates-chart-pools/hashrate-chart-pools.component';
import { MempoolBlockComponent } from '@components/mempool-block/mempool-block.component';
import { MiningDashboardComponent } from '@components/mining-dashboard/mining-dashboard.component';
import { PoolRankingComponent } from '@components/pool-ranking/pool-ranking.component';
import { PoolsListComponent } from '@components/pools-list/pools-list.component';
import { PoolComponent } from '@components/pool/pool.component';
import { StartComponent } from '@components/start/start.component';
import { StatisticsComponent } from '@components/statistics/statistics.component';
import { DashboardComponent } from '@app/dashboard/dashboard.component';
import { CustomDashboardComponent } from '@components/custom-dashboard/custom-dashboard.component';
import { TreasuriesComponent } from '@components/treasuries/treasuries.component';
import { AddressComponent } from '@components/address/address.component';
import { WalletComponent } from '@components/wallet/wallet.component';
import { TokenDetailsComponent } from '@components/token-details/token-details.component';
import { AsertDeviationGraphPageComponent } from '@components/asert-deviation-graph-page/asert-deviation-graph-page.component';
import { BlockTxCountsGraphComponent } from '@components/block-tx-counts-graph/block-tx-counts-graph.component';
import { BlockVolumeGraphComponent } from '@components/block-volume-graph/block-volume-graph.component';
import { UtxoSizeGraphComponent } from '@app/components/utxo-size-graph/utxo-size-graph.component';

const browserWindow = window || {};
// @ts-ignore
const browserWindowEnv = browserWindow.__env || {};
const isCustomized = browserWindowEnv?.customize?.dashboard;

const routes: Routes = [
  {
    path: '',
    children: [
      {
        path: 'mining/pools',
        data: { networks: ['bitcoin'] },
        component: PoolsListComponent,
      },
      {
        path: 'mining/pool/:slug',
        data: { networks: ['bitcoin'] },
        component: PoolComponent,
      },
      {
        path: 'mining',
        data: { networks: ['bitcoin'] },
        component: StartComponent,
        children: [
          {
            path: '',
            component: MiningDashboardComponent,
          },
        ],
      },
      {
        path: 'mempool-block/:id',
        data: { networks: ['bitcoin'] },
        component: StartComponent,
        children: [
          {
            path: '',
            component: MempoolBlockComponent,
          },
        ],
      },
      {
        path: 'address/:id',
        children: [],
        component: AddressComponent,
        data: {
          ogImage: true,
          networkSpecific: true,
        },
      },
      {
        path: 'token/:category',
        children: [],
        component: TokenDetailsComponent,
        data: {
          ogImage: true,
          networkSpecific: true,
        },
      },
      {
        path: 'wallet/:wallet',
        children: [],
        component: WalletComponent,
        data: {
          ogImage: true,
          networkSpecific: true,
        },
      },
      {
        path: 'graphs',
        data: { networks: ['bitcoin'] },
        component: GraphsComponent,
        children: [
          {
            path: 'mempool',
            data: { networks: ['bitcoin'] },
            component: StatisticsComponent,
          },
          {
            path: 'mining/hashrate-difficulty',
            data: { networks: ['bitcoin'] },
            component: HashrateChartComponent,
          },
          {
            path: 'mining/pools-dominance',
            data: { networks: ['bitcoin'] },
            component: HashrateChartPoolsComponent,
          },
          {
            path: 'mining/pools',
            data: { networks: ['bitcoin'] },
            component: PoolRankingComponent,
          },
          {
            path: 'mining/block-fees',
            data: { networks: ['bitcoin'] },
            component: BlockFeesGraphComponent,
          },
          {
            path: 'mining/block-fees-subsidy',
            data: { networks: ['bitcoin'] },
            component: BlockFeesSubsidyGraphComponent,
          },
          {
            path: 'mining/block-rewards',
            data: { networks: ['bitcoin'] },
            component: BlockRewardsGraphComponent,
          },
          {
            path: 'mining/block-fee-rates',
            data: { networks: ['bitcoin'] },
            component: BlockFeeRatesGraphComponent,
          },
          {
            path: 'mining/block-sizes',
            data: { networks: ['bitcoin'] },
            component: BlockSizesGraphComponent,
          },
          {
            path: 'mining/block-times',
            data: { networks: ['bitcoin'] },
            component: BlockTimesGraphComponent,
          },
          {
            path: 'mining/block-tx-counts',
            data: { networks: ['bitcoin'] },
            component: BlockTxCountsGraphComponent,
          },
          {
            path: 'mining/block-volume',
            data: { networks: ['bitcoin'] },
            component: BlockVolumeGraphComponent,
          },
          {
            path: 'mining/utxo-size',
            data: { networks: ['bitcoin'] },
            component: UtxoSizeGraphComponent,
          },
          {
            path: 'mining/asert-deviation',
            data: { networks: ['bitcoin'] },
            component: AsertDeviationGraphPageComponent,
          },
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'mempool',
          },
          {
            path: 'mining/block-health',
            data: { networks: ['bitcoin'] },
            component: BlockHealthGraphComponent,
          },
          {
            path: 'price',
            data: {
              networks: ['bitcoin'],
              networkSpecific: true,
              onlySubnet: [''],
            },
            component: PriceChartComponent,
          },
        ],
      },
      {
        path: 'treasuries',
        component: StartComponent,
        children: [
          {
            path: '',
            component: TreasuriesComponent,
            data: {
              networks: ['bitcoin'],
              networkSpecific: true,
            },
          },
        ],
      },
      {
        path: '',
        component: StartComponent,
        children: [
          {
            path: '',
            component: isCustomized
              ? CustomDashboardComponent
              : DashboardComponent,
          },
        ],
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
})
export class GraphsRoutingModule {}
