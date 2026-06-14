import { NgModule } from '@angular/core';
import { NgxEchartsModule } from 'ngx-echarts';
import { GraphsRoutingModule } from '@app/graphs/graphs.routing.module';
import { SharedModule } from '@app/shared/shared.module';

import { BlockFeesGraphComponent } from '@components/block-fees-graph/block-fees-graph.component';
import { BlockFeesSubsidyGraphComponent } from '@components/block-fees-subsidy-graph/block-fees-subsidy-graph.component';
import { PriceChartComponent } from '@components/price-chart/price-chart.component';
import { BlockRewardsGraphComponent } from '@components/block-rewards-graph/block-rewards-graph.component';
import { BlockFeeRatesGraphComponent } from '@components/block-fee-rates-graph/block-fee-rates-graph.component';
import { BlockSizesGraphComponent } from '@components/block-sizes-graph/block-sizes-graph.component';
import { BlockTimesGraphComponent } from '@components/block-times-graph/block-times-graph.component';
import { FeeDistributionGraphComponent } from '@components/fee-distribution-graph/fee-distribution-graph.component';
import { IncomingTransactionsGraphComponent } from '@components/incoming-transactions-graph/incoming-transactions-graph.component';
import { MempoolGraphComponent } from '@components/mempool-graph/mempool-graph.component';
import { GraphsComponent } from '@components/graphs/graphs.component';
import { StatisticsComponent } from '@components/statistics/statistics.component';
import { MempoolBlockComponent } from '@components/mempool-block/mempool-block.component';
import { PoolRankingComponent } from '@components/pool-ranking/pool-ranking.component';
import { PoolsListComponent } from '@components/pools-list/pools-list.component';
import { PoolComponent } from '@components/pool/pool.component';
import { TokenDetailsComponent } from '@components/token-details/token-details.component';
import { DashboardComponent } from '@app/dashboard/dashboard.component';
import { CustomDashboardComponent } from '@components/custom-dashboard/custom-dashboard.component';
import { MiningDashboardComponent } from '@components/mining-dashboard/mining-dashboard.component';
import { TreasuriesComponent } from '@components/treasuries/treasuries.component';
import { HashrateChartComponent } from '@components/hashrate-chart/hashrate-chart.component';
import { HashrateChartPoolsComponent } from '@components/hashrates-chart-pools/hashrate-chart-pools.component';
import { BlockHealthGraphComponent } from '@components/block-health-graph/block-health-graph.component';
import { AddressComponent } from '@components/address/address.component';
import { WalletComponent } from '@components/wallet/wallet.component';
import { WalletPreviewComponent } from '@components/wallet/wallet-preview.component';
import { AddressGraphComponent } from '@components/address-graph/address-graph.component';
import { TreasuriesGraphComponent } from '@components/treasuries/treasuries-graph/treasuries-graph.component';
import { TreasuriesPieComponent } from '@components/treasuries/treasuries-pie/treasuries-pie.component';
import { TreasuriesSupplyComponent } from '@components/treasuries/supply/treasuries-supply.component';
import { TreasuriesVerifyProgressComponent } from '@components/treasuries/verify/treasuries-verify.component';
import { UtxoGraphComponent } from '@components/utxo-graph/utxo-graph.component';
import { AddressesTreemap } from '@components/addresses-treemap/addresses-treemap.component';
import { CommonModule } from '@angular/common';
import { AsmStylerPipe } from '@app/shared/pipes/asm-styler/asm-styler.pipe';
import { AsertDeviationGraphPageComponent } from '@components/asert-deviation-graph-page/asert-deviation-graph-page.component';
import { BlockTxCountsGraphComponent } from '@components/block-tx-counts-graph/block-tx-counts-graph.component';
import { BlockVolumeGraphComponent } from '@components/block-volume-graph/block-volume-graph.component';
import { UtxoSizeGraphComponent } from '@app/components/utxo-size-graph/utxo-size-graph.component';

@NgModule({
  declarations: [
    DashboardComponent,
    CustomDashboardComponent,
    MempoolBlockComponent,
    AddressComponent,
    WalletComponent,
    WalletPreviewComponent,

    MiningDashboardComponent,
    PoolsListComponent,
    PoolComponent,
    TokenDetailsComponent,
    PoolRankingComponent,
    TreasuriesComponent,
    StatisticsComponent,
    GraphsComponent,
    BlockFeesGraphComponent,
    BlockFeesSubsidyGraphComponent,
    PriceChartComponent,
    BlockRewardsGraphComponent,
    BlockFeeRatesGraphComponent,
    BlockSizesGraphComponent,
    BlockTimesGraphComponent,
    FeeDistributionGraphComponent,
    IncomingTransactionsGraphComponent,
    MempoolGraphComponent,
    HashrateChartComponent,
    HashrateChartPoolsComponent,
    BlockHealthGraphComponent,
    AddressGraphComponent,
    TreasuriesGraphComponent,
    TreasuriesPieComponent,
    TreasuriesSupplyComponent,
    TreasuriesVerifyProgressComponent,
    UtxoGraphComponent,
    AddressesTreemap,
    AsertDeviationGraphPageComponent,
    BlockTxCountsGraphComponent,
    BlockVolumeGraphComponent,
    UtxoSizeGraphComponent,
  ],
  imports: [
    CommonModule,
    SharedModule,
    GraphsRoutingModule,
    NgxEchartsModule.forRoot({
      echarts: () => import('@app/graphs/echarts').then((m) => m.echarts),
    }),
  ],
  exports: [NgxEchartsModule],
  providers: [AsmStylerPipe],
})
export class GraphsModule {}
