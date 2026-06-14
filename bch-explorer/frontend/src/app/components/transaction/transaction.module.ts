import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Routes, RouterModule } from '@angular/router';
import { TransactionComponent } from '@components/transaction/transaction.component';
import { TransactionDetailsComponent } from '@components/transaction/transaction-details/transaction-details.component';
import { SharedModule } from '@app/shared/shared.module';
import { TxBowtieModule } from '@components/tx-bowtie-graph/tx-bowtie.module';
import { TransactionExtrasModule } from '@components/transaction/transaction-extras.module';
import { GraphsModule } from '@app/graphs/graphs.module';
import { TransactionRawComponent } from '@components/transaction/transaction-raw.component';

const routes: Routes = [
  {
    path: '',
    redirectTo: '/',
    pathMatch: 'full',
  },
  {
    path: 'preview',
    component: TransactionRawComponent,
  },
  {
    path: ':id',
    component: TransactionComponent,
    data: {
      ogImage: true,
    },
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TransactionRoutingModule {}

@NgModule({
  imports: [
    CommonModule,
    TransactionRoutingModule,
    SharedModule,
    GraphsModule,
    TxBowtieModule,
    TransactionExtrasModule,
  ],
  declarations: [
    TransactionComponent,
    TransactionDetailsComponent,
    TransactionRawComponent,
  ],
  exports: [TransactionComponent, TransactionDetailsComponent],
})
export class TransactionModule {}
