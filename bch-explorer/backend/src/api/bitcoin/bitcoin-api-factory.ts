import config from '../../config';
import { AbstractBitcoinApi } from './bitcoin-api-abstract-factory';
import BitcoinApi from './bitcoin-api';
import ElectrumApi from './electrum-api';
import bitcoinClient from './bitcoin-client';

function bitcoinApiFactory(): AbstractBitcoinApi {
  switch (config.EXPLORER.BACKEND) {
    case 'electrum':
      return new ElectrumApi(bitcoinClient);
    case 'none':
    default:
      return new BitcoinApi(bitcoinClient);
  }
}

export const bitcoinCoreApi = new BitcoinApi(bitcoinClient);

export default bitcoinApiFactory();
