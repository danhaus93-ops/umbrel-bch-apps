import { Common } from '../../api/common';

const randomTransactions = require('./test-data/transactions-random.json');

const standardTransactions = require('./test-data/standard-txs.json');
const nonStandardTransactions = require('./test-data/btc-txs.json');

describe('Common', () => {
  describe('Mempool Goggles', () => {
    test('should detect standard transactions', () => {
      standardTransactions.forEach((tx) => {
        expect(Common.isNonStandard(tx)).toEqual(false);
      });
    });

    test('should detect nonstandard transactions', () => {
      nonStandardTransactions.forEach((tx) => {
        expect(Common.isNonStandard(tx)).toEqual(true);
      });
    });

    test('should not misclassify as nonstandard transactions', () => {
      randomTransactions.forEach((tx) => {
        expect(Common.isNonStandard(tx)).toEqual(false);
      });
    });
  });
});
