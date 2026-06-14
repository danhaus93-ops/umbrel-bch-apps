import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DocsComponent } from '@app/docs/docs/docs.component';

const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'faq',
  },
  {
    path: 'api/:type',
    component: DocsComponent,
  },
  {
    path: 'faq',
    data: { networks: ['bitcoin'] },
    component: DocsComponent,
  },
  {
    path: 'api',
    redirectTo: 'api/rest',
  },
  {
    path: '**',
    redirectTo: 'faq',
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
})
export class DocsRoutingModule {}
