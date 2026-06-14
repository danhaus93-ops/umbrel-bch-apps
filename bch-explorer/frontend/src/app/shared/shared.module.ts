import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  NgbCollapseModule,
  NgbTypeaheadModule,
  NgbNavModule,
  NgbTooltipModule,
  NgbPaginationModule,
  NgbDropdownModule,
  NgbDatepickerModule,
} from '@ng-bootstrap/ng-bootstrap';
import {
  FontAwesomeModule,
  FaIconLibrary,
} from '@fortawesome/angular-fontawesome';
import {
  faFilter,
  faAngleDown,
  faAngleUp,
  faAngleRight,
  faAngleLeft,
  faBolt,
  faCogs,
  faDatabase,
  faExchangeAlt,
  faInfoCircle,
  faLink,
  faList,
  faSearch,
  faCaretUp,
  faCaretDown,
  faTachometerAlt,
  faThList,
  faTint,
  faClock,
  faAngleDoubleDown,
  faSortUp,
  faAngleDoubleUp,
  faChevronDown,
  faFileAlt,
  faRedoAlt,
  faArrowAltCircleRight,
  faExternalLinkAlt,
  faListUl,
  faDownload,
  faQrcode,
  faArrowRightArrowLeft,
  faArrowsRotate,
  faCircleLeft,
  faFastForward,
  faWallet,
  faUserClock,
  faWrench,
  faUserFriends,
  faQuestionCircle,
  faHistory,
  faSignOutAlt,
  faKey,
  faSuitcase,
  faIdCardAlt,
  faNetworkWired,
  faUserCheck,
  faCircleCheck,
  faUserCircle,
  faCheck,
  faRocket,
  faScaleBalanced,
  faHourglassStart,
  faHourglassHalf,
  faHourglassEnd,
  faWandMagicSparkles,
  faTimeline,
  faCircleXmark,
  faCalendarCheck,
  faMoneyBillTrendUp,
  faRobot,
  faShareNodes,
  faCreditCard,
  faMicroscope,
  faExclamationTriangle,
  faLockOpen,
  faPaperclip,
  faAddressCard,
  faMedal,
  faBug,
  faFilePdf,
  faPiggyBank,
  faLayerGroup,
  faHeart,
  faCashRegister,
  faTag,
  faCodeFork,
  faCode,
  faCalendar,
  faPause,
  faPlay,
} from '@fortawesome/free-solid-svg-icons';
import { InfiniteScrollModule } from 'ngx-infinite-scroll';
import { MenuComponent } from '@components/menu/menu.component';
import { PreviewTitleComponent } from '@components/master-page-preview/preview-title.component';
import { LimitToPipe } from '@app/shared/pipes/limit-to-pipe/limit-to.pipe';
import { ShortenStringPipe } from '@app/shared/pipes/shorten-string-pipe/shorten-string.pipe';
import { CeilPipe } from '@app/shared/pipes/math-ceil/math-ceil.pipe';
import { Hex2asciiPipe } from '@app/shared/pipes/hex2ascii/hex2ascii.pipe';
import { Decimal2HexPipe } from '@app/shared/pipes/decimal2hex/decimal2hex.pipe';
import { FeeRoundingPipe } from '@app/shared/pipes/fee-rounding/fee-rounding.pipe';
import { AsmStylerPipe } from '@app/shared/pipes/asm-styler/asm-styler.pipe';
import { AsmComponent } from '@app/shared/components/asm/asm.component';
import { AbsolutePipe } from '@app/shared/pipes/absolute/absolute.pipe';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { ScriptpubkeyTypePipe } from '@app/shared/pipes/scriptpubkey-type-pipe/scriptpubkey-type.pipe';
import { BytesPipe } from '@app/shared/pipes/bytes-pipe/bytes.pipe';
import { FiatCurrencyPipe } from '@app/shared/pipes/fiat-currency.pipe';
import { HttpErrorPipe } from '@app/shared/pipes/http-error-pipe/http-error.pipe';
import { BlockchainComponent } from '@components/blockchain/blockchain.component';
import { TimeComponent } from '@components/time/time.component';
import { ClipboardComponent } from '@components/clipboard/clipboard.component';
import { QrcodeComponent } from '@components/qrcode/qrcode.component';
import { FiatComponent } from '@app/fiat/fiat.component';
import { TxFeaturesComponent } from '@components/tx-features/tx-features.component';
import { TxFeeRatingComponent } from '@components/tx-fee-rating/tx-fee-rating.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { LanguageSelectorComponent } from '@components/language-selector/language-selector.component';
import { FiatSelectorComponent } from '@components/fiat-selector/fiat-selector.component';
import { RateUnitSelectorComponent } from '@components/rate-unit-selector/rate-unit-selector.component';
import { ThemeSelectorComponent } from '@components/theme-selector/theme-selector.component';
import { AmountSelectorComponent } from '@components/amount-selector/amount-selector.component';
import { TimezoneSelectorComponent } from '@components/timezone-selector/timezone-selector.component';
import { BrowserOnlyDirective } from '@app/shared/directives/browser-only.directive';
import { ServerOnlyDirective } from '@app/shared/directives/server-only.directive';
import { ColoredPriceDirective } from '@app/shared/directives/colored-price.directive';
import { NoSanitizePipe } from '@app/shared/pipes/no-sanitize.pipe';
import { LinkifyPipe } from '@app/shared/pipes/linkify.pipe';
import { MempoolBlocksComponent } from '@components/mempool-blocks/mempool-blocks.component';
import { BlockchainBlocksComponent } from '@components/blockchain-blocks/blockchain-blocks.component';
import { AmountComponent } from '@components/amount/amount.component';
import { RouterModule } from '@angular/router';
import { CapAddressPipe } from '@app/shared/pipes/cap-address-pipe/cap-address-pipe';
import { StartComponent } from '@components/start/start.component';
import { TransactionsListComponent } from '@components/transactions-list/transactions-list.component';
import { BlockOverviewGraphComponent } from '@components/block-overview-graph/block-overview-graph.component';
import { BlockOverviewTooltipComponent } from '@components/block-overview-tooltip/block-overview-tooltip.component';
import { BlockFiltersComponent } from '@components/block-filters/block-filters.component';
import { AddressGroupComponent } from '@components/address-group/address-group.component';
import { SearchFormComponent } from '@components/search-form/search-form.component';
import { AddressLabelsComponent } from '@components/address-labels/address-labels.component';
import { FooterComponent } from '@components/footer/footer.component';
import { StatusViewComponent } from '@components/status-view/status-view.component';
import { ServerHealthComponent } from '@components/server-health/server-health.component';
import { ServerStatusComponent } from '@components/server-health/server-status.component';
import { FeesBoxComponent } from '@components/fees-box/fees-box.component';
import { DifficultyComponent } from '@components/difficulty/difficulty.component';
import { DifficultyTooltipComponent } from '@components/difficulty/difficulty-tooltip.component';
import { ChainStatsMiningComponent } from '@components/chain-stats-mining/chain-stats-mining.component';
import { BalanceWidgetComponent } from '@components/balance-widget/balance-widget.component';
import { AddressTransactionsWidgetComponent } from '@components/address-transactions-widget/address-transactions-widget.component';
import { PushTransactionComponent } from '@components/push-transaction/push-transaction.component';
import { TestTransactionsComponent } from '@components/test-transactions/test-transactions.component';
import { AmountShortenerPipe } from '@app/shared/pipes/amount-shortener.pipe';
import { DifficultyAdjustmentsTable } from '@components/difficulty-adjustments-table/difficulty-adjustments-table.components';
import { BlocksList } from '@components/blocks-list/blocks-list.component';
import { RecentTransactionsList } from '@components/recent-transactions-list/recent-transactions-list.component';
import { StaleList } from '@components/stale-list/stale-list.component';
import { StratumList } from '@components/stratum/stratum-list/stratum-list.component';
import { RewardStatsComponent } from '@components/reward-stats/reward-stats.component';
import { DataCyDirective } from '@app/data-cy.directive';
import { LoadingIndicatorComponent } from '@components/loading-indicator/loading-indicator.component';
import { IndexingProgressComponent } from '@components/indexing-progress/indexing-progress.component';
import { SvgImagesComponent } from '@components/svg-images/svg-images.component';
import { ChangeComponent } from '@components/change/change.component';
import { SatsComponent } from '@app/shared/components/sats/sats.component';
import { BchComponent } from '@app/shared/components/bch/bch.component';
import { FeeRateComponent } from '@app/shared/components/fee-rate/fee-rate.component';
import { AddressTypeComponent } from '@app/shared/components/address-type/address-type.component';
import { AddressTextComponent } from '@app/shared/components/address-text/address-text.component';
import { TruncateComponent } from '@app/shared/components/truncate/truncate.component';
import { TokenIconAndTextComponent } from '@app/shared/components/token-icon-and-text/token-icon-and-text.component';
import { TokenNftComponent } from '@app/shared/components/token-nft/token-nft.component';
import { SearchResultsComponent } from '@components/search-form/search-results/search-results.component';
import { TimestampComponent } from '@app/shared/components/timestamp/timestamp.component';
import { ConfirmationsComponent } from '@app/shared/components/confirmations/confirmations.component';
import { ToggleComponent } from '@app/shared/components/toggle/toggle.component';
import { GeolocationComponent } from '@app/shared/components/geolocation/geolocation.component';
import { TestnetAlertComponent } from '@app/shared/components/testnet-alert/testnet-alert.component';
import { NotificationComponent } from '@app/shared/components/notification/notification.component';
import { GlobalFooterComponent } from '@app/shared/components/global-footer/global-footer.component';
import { MempoolErrorComponent } from '@app/shared/components/mempool-error/mempool-error.component';
import { MiningPoolComponent } from '@app/shared/components/mining-pool/mining-pool.component';
import { VerifyAddressComponent } from '../components/verify-address/verify-address.component';
import { NgxEchartsModule } from 'ngx-echarts';
import { AsertDeviationGraphComponent } from '@app/components/asert-deviation-graph/asert-deviation-graph.component';

import { BlockViewComponent } from '@components/block-view/block-view.component';
import { EightBlocksComponent } from '@components/eight-blocks/eight-blocks.component';
import { MempoolBlockViewComponent } from '@components/mempool-block-view/mempool-block-view.component';
import { MempoolBlockOverviewComponent } from '@components/mempool-block-overview/mempool-block-overview.component';
import { ClockchainComponent } from '@components/clockchain/clockchain.component';
import { ClockFaceComponent } from '@components/clock-face/clock-face.component';
import { ClockComponent } from '@components/clock/clock.component';
import { CalculatorComponent } from '@components/calculator/calculator.component';
import { BitcoinsatoshisPipe } from '@app/shared/pipes/bitcoinsatoshis.pipe';
import { HttpErrorComponent } from '@app/shared/components/http-error/http-error.component';
import { TwitterWidgetComponent } from '@components/twitter-widget/twitter-widget.component';
import { SimpleProofWidgetComponent } from '@components/simpleproof-widget/simpleproof-widget.component';
import { SimpleProofCuboWidgetComponent } from '@components/simpleproof-widget/simpleproof-cubo-widget.component';
import { FaucetComponent } from '@components/faucet/faucet.component';
import { TwitterLogin } from '@components/twitter-login/twitter-login.component';
import { GithubLogin } from '@components/github-login.component/github-login.component';
import { MempoolProgressBarComponent } from '@components/mempool-progress-bar/mempool-progress-bar.component';
import { SpecialBlocksComponent } from '@components/special-blocks/special-blocks.component';
import { AddressConverterComponent } from '@components/address-converter/address-converter.component';
import { BchWebringComponent } from '@app/shared/components/bch-webring/bch-webring.component';

@NgModule({
  declarations: [
    ClipboardComponent,
    TimeComponent,
    QrcodeComponent,
    FiatComponent,
    TxFeaturesComponent,
    TxFeeRatingComponent,
    LanguageSelectorComponent,
    FiatSelectorComponent,
    ThemeSelectorComponent,
    RateUnitSelectorComponent,
    AmountSelectorComponent,
    TimezoneSelectorComponent,
    ScriptpubkeyTypePipe,
    RelativeUrlPipe,
    NoSanitizePipe,
    LinkifyPipe,
    Hex2asciiPipe,
    AsmStylerPipe,
    AsmComponent,
    AbsolutePipe,
    BytesPipe,
    CeilPipe,
    LimitToPipe,
    ShortenStringPipe,
    CapAddressPipe,
    Decimal2HexPipe,
    FeeRoundingPipe,
    FiatCurrencyPipe,
    HttpErrorPipe,
    ColoredPriceDirective,
    BrowserOnlyDirective,
    ServerOnlyDirective,
    BlockchainComponent,
    BlockViewComponent,
    EightBlocksComponent,
    MempoolBlockViewComponent,
    MempoolBlocksComponent,
    BlockchainBlocksComponent,
    AmountComponent,
    MenuComponent,
    PreviewTitleComponent,
    StartComponent,
    BlockOverviewGraphComponent,
    BlockOverviewTooltipComponent,
    BlockFiltersComponent,
    TransactionsListComponent,
    AddressGroupComponent,
    SearchFormComponent,
    AddressLabelsComponent,
    FooterComponent,
    StatusViewComponent,
    ServerHealthComponent,
    ServerStatusComponent,
    FeesBoxComponent,
    DifficultyComponent,
    ChainStatsMiningComponent,
    DifficultyTooltipComponent,
    BalanceWidgetComponent,
    AddressTransactionsWidgetComponent,
    PushTransactionComponent,
    TestTransactionsComponent,
    AmountShortenerPipe,
    DifficultyAdjustmentsTable,
    BlocksList,
    RecentTransactionsList,
    StaleList,
    StratumList,
    DataCyDirective,
    RewardStatsComponent,
    LoadingIndicatorComponent,
    IndexingProgressComponent,
    SvgImagesComponent,
    ChangeComponent,
    SatsComponent,
    BchComponent,
    FeeRateComponent,
    AddressTypeComponent,
    AddressTextComponent,
    TruncateComponent,
    TokenIconAndTextComponent,
    TokenNftComponent,
    SearchResultsComponent,
    TimestampComponent,
    ConfirmationsComponent,
    ToggleComponent,
    GeolocationComponent,
    TestnetAlertComponent,
    NotificationComponent,
    GlobalFooterComponent,
    MiningPoolComponent,
    CalculatorComponent,
    BitcoinsatoshisPipe,
    BlockViewComponent,
    EightBlocksComponent,
    MempoolBlockViewComponent,
    MempoolBlockOverviewComponent,
    ClockchainComponent,
    ClockComponent,
    ClockFaceComponent,
    MempoolErrorComponent,
    HttpErrorComponent,
    TwitterWidgetComponent,
    SimpleProofWidgetComponent,
    SimpleProofCuboWidgetComponent,
    FaucetComponent,
    TwitterLogin,
    GithubLogin,
    MempoolProgressBarComponent,
    VerifyAddressComponent,
    SpecialBlocksComponent,
    AddressConverterComponent,
    AsertDeviationGraphComponent,
    BchWebringComponent,
  ],
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    NgbNavModule,
    NgbTooltipModule,
    NgbPaginationModule,
    NgbTypeaheadModule,
    NgbDropdownModule,
    NgbCollapseModule,
    NgbDatepickerModule,
    InfiniteScrollModule,
    FontAwesomeModule,
    NgxEchartsModule.forRoot({
      echarts: () => import('@app/graphs/echarts').then((m) => m.echarts),
    }),
  ],
  providers: [
    BytesPipe,
    RelativeUrlPipe,
    NoSanitizePipe,
    LimitToPipe,
    ShortenStringPipe,
    CapAddressPipe,
    AmountShortenerPipe,
    FeeRoundingPipe,
  ],
  exports: [
    MenuComponent,
    RouterModule,
    ReactiveFormsModule,
    NgbNavModule,
    NgbTooltipModule,
    NgbPaginationModule,
    NgbTypeaheadModule,
    NgbDropdownModule,
    NgbCollapseModule,
    NgbDatepickerModule,
    InfiniteScrollModule,
    FontAwesomeModule,
    TimeComponent,
    ClipboardComponent,
    QrcodeComponent,
    FiatComponent,
    TxFeaturesComponent,
    TxFeeRatingComponent,
    LanguageSelectorComponent,
    FiatSelectorComponent,
    RateUnitSelectorComponent,
    ThemeSelectorComponent,
    AmountSelectorComponent,
    TimezoneSelectorComponent,
    ScriptpubkeyTypePipe,
    RelativeUrlPipe,
    Hex2asciiPipe,
    AsmStylerPipe,
    AbsolutePipe,
    BytesPipe,
    FiatCurrencyPipe,
    HttpErrorPipe,
    CeilPipe,
    LimitToPipe,
    ShortenStringPipe,
    CapAddressPipe,
    Decimal2HexPipe,
    FeeRoundingPipe,
    ColoredPriceDirective,
    BrowserOnlyDirective,
    ServerOnlyDirective,
    NoSanitizePipe,
    LinkifyPipe,
    BlockchainComponent,
    MempoolBlocksComponent,
    BlockchainBlocksComponent,
    AmountComponent,
    StartComponent,
    BlockOverviewGraphComponent,
    BlockOverviewTooltipComponent,
    BlockFiltersComponent,
    TransactionsListComponent,
    AddressGroupComponent,
    SearchFormComponent,
    AddressLabelsComponent,
    FooterComponent,
    StatusViewComponent,
    ServerHealthComponent,
    ServerStatusComponent,
    FeesBoxComponent,
    DifficultyComponent,
    ChainStatsMiningComponent,
    DifficultyTooltipComponent,
    BalanceWidgetComponent,
    AddressTransactionsWidgetComponent,
    PushTransactionComponent,
    TestTransactionsComponent,
    AmountShortenerPipe,
    DifficultyAdjustmentsTable,
    BlocksList,
    RecentTransactionsList,
    StaleList,
    StratumList,
    DataCyDirective,
    RewardStatsComponent,
    LoadingIndicatorComponent,
    IndexingProgressComponent,
    SvgImagesComponent,
    ChangeComponent,
    SatsComponent,
    BchComponent,
    FeeRateComponent,
    AddressTypeComponent,
    AddressTextComponent,
    TruncateComponent,
    TokenIconAndTextComponent,
    TokenNftComponent,
    SearchResultsComponent,
    TimestampComponent,
    ConfirmationsComponent,
    ToggleComponent,
    GeolocationComponent,
    TestnetAlertComponent,
    NotificationComponent,
    MiningPoolComponent,
    PreviewTitleComponent,
    GlobalFooterComponent,
    MempoolErrorComponent,
    HttpErrorComponent,
    TwitterWidgetComponent,
    SimpleProofWidgetComponent,
    SimpleProofCuboWidgetComponent,
    TwitterLogin,
    GithubLogin,
    MempoolProgressBarComponent,
    BitcoinsatoshisPipe,
    VerifyAddressComponent,
    SpecialBlocksComponent,
    AddressConverterComponent,
    AsertDeviationGraphComponent,
    BchWebringComponent,

    MempoolBlockOverviewComponent,
    ClockchainComponent,
    ClockComponent,
    ClockFaceComponent,
  ],
})
export class SharedModule {
  constructor(library: FaIconLibrary) {
    library.addIcons(faInfoCircle);
    library.addIcons(faClock);
    library.addIcons(faTachometerAlt);
    library.addIcons(faCogs);
    library.addIcons(faThList);
    library.addIcons(faList);
    library.addIcons(faDatabase);
    library.addIcons(faSearch);
    library.addIcons(faLink);
    library.addIcons(faBolt);
    library.addIcons(faTint);
    library.addIcons(faFilter);
    library.addIcons(faAngleDown);
    library.addIcons(faAngleUp);
    library.addIcons(faExchangeAlt);
    library.addIcons(faAngleDoubleUp);
    library.addIcons(faAngleDoubleDown);
    library.addIcons(faChevronDown);
    library.addIcons(faFileAlt);
    library.addIcons(faRedoAlt);
    library.addIcons(faArrowAltCircleRight);
    library.addIcons(faArrowsRotate);
    library.addIcons(faCircleLeft);
    library.addIcons(faExternalLinkAlt);
    library.addIcons(faSortUp);
    library.addIcons(faCaretUp);
    library.addIcons(faCaretDown);
    library.addIcons(faAngleRight);
    library.addIcons(faAngleLeft);
    library.addIcons(faListUl);
    library.addIcons(faDownload);
    library.addIcons(faQrcode);
    library.addIcons(faArrowRightArrowLeft);
    library.addIcons(faExchangeAlt);
    library.addIcons(faList);
    library.addIcons(faFastForward);
    library.addIcons(faWallet);
    library.addIcons(faUserClock);
    library.addIcons(faWrench);
    library.addIcons(faUserFriends);
    library.addIcons(faQuestionCircle);
    library.addIcons(faHistory);
    library.addIcons(faSignOutAlt);
    library.addIcons(faKey);
    library.addIcons(faSuitcase);
    library.addIcons(faIdCardAlt);
    library.addIcons(faNetworkWired);
    library.addIcons(faUserCheck);
    library.addIcons(faCircleCheck);
    library.addIcons(faUserCircle);
    library.addIcons(faCheck);
    library.addIcons(faRocket);
    library.addIcons(faScaleBalanced);
    library.addIcons(faHourglassStart);
    library.addIcons(faHourglassHalf);
    library.addIcons(faHourglassEnd);
    library.addIcons(faWandMagicSparkles);
    library.addIcons(faTimeline);
    library.addIcons(faCircleXmark);
    library.addIcons(faCalendarCheck);
    library.addIcons(faCalendar);
    library.addIcons(faMoneyBillTrendUp);
    library.addIcons(faRobot);
    library.addIcons(faShareNodes);
    library.addIcons(faCreditCard);
    library.addIcons(faMicroscope);
    library.addIcons(faExclamationTriangle);
    library.addIcons(faLockOpen);
    library.addIcons(faPaperclip);
    library.addIcons(faMedal);
    library.addIcons(faAddressCard);
    library.addIcons(faBug);
    library.addIcons(faFilePdf);
    library.addIcons(faPiggyBank);
    library.addIcons(faLayerGroup);
    library.addIcons(faHeart);
    library.addIcons(faCashRegister);
    library.addIcons(faTag);
    library.addIcons(faCodeFork);
    library.addIcons(faCode);
    library.addIcons(faPause);
    library.addIcons(faPlay);
  }
}
