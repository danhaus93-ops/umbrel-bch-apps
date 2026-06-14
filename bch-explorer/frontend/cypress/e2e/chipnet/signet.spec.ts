import { emitMempoolInfo } from '../../support/websocket';

const baseModule = Cypress.env('BASE_MODULE');

describe('Chipnet', () => {
  beforeEach(() => {
    cy.intercept('/api/block-height/*').as('block-height');
    cy.intercept('/api/block/*').as('block');
    cy.intercept('/api/block/*/txs/0').as('block-txs');
    cy.intercept('/api/tx/*/outspends').as('tx-outspends');
  });


  if (baseModule === 'explorer') {
    it('loads the dashboard', () => {
      cy.visit('/chipnet');
      cy.waitForSkeletonGone();
    });

    it('check first mempool block after skeleton loads', () => {
      cy.visit('/');
      cy.waitForSkeletonGone();
      cy.get('#mempool-block-0 > .blockLink').should('exist');
    });

    it.skip('loads the dashboard with the skeleton blocks', () => {
      cy.mockMempoolSocket();
      cy.visit('/chipnet');
      cy.get(':nth-child(1) > #bitcoin-block-0').should('be.visible');
      cy.get(':nth-child(2) > #bitcoin-block-0').should('be.visible');
      cy.get(':nth-child(3) > #bitcoin-block-0').should('be.visible');
      cy.get('#mempool-block-0').should('be.visible');
      cy.get('#mempool-block-1').should('be.visible');
      cy.get('#mempool-block-2').should('be.visible');

      emitMempoolInfo({
        'params': {
          'network': 'chipnet'
        }
      });

      cy.get(':nth-child(1) > #bitcoin-block-0').should('not.exist');
      cy.get(':nth-child(2) > #bitcoin-block-0').should('not.exist');
      cy.get(':nth-child(3) > #bitcoin-block-0').should('not.exist');
    });

    it('loads the pools screen', () => {
      cy.visit('/chipnet');
      cy.waitForSkeletonGone();
      cy.get('#btn-pools').click().then(() => {
        cy.wait(1000);
      });
    });

    it('loads the graphs screen', () => {
      cy.visit('/chipnet');
      cy.waitForSkeletonGone();
      cy.get('#btn-graphs').click().then(() => {
        cy.wait(1000);
      });
    });

    it('loads the api screen', () => {
      cy.visit('/chipnet');
      cy.waitForSkeletonGone();
      cy.get('#btn-docs').click().then(() => {
        cy.wait(1000);
      });
    });

    describe('blocks', () => {
      it('expands and collapses the block details', () => {
        cy.visit('/chipnet/block/0');
        cy.get('.pagination').scrollIntoView({ offset: { top: 200, left: 0 } });
        cy.waitForSkeletonGone();
        cy.get('.btn.btn-outline-info').click().then(() => {
          cy.get('#details').should('be.visible');
        });

        cy.get('.btn.btn-outline-info').click().then(() => {
          cy.get('#details').should('not.be.visible');
        });
      });
    });
  } else {
    it.skip(`Tests cannot be run on the selected BASE_MODULE ${baseModule}`);
  }
});
