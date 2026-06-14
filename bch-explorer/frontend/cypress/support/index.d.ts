
/// <reference types="cypress" />
declare namespace Cypress {
    interface Chainable<Subject> {
        waitForSkeletonGone(): Chainable<any>
        waitForPageIdle(): Chainable<any>
        mockMempoolSocket(): Chainable<any>
        mockMempoolSocketV2(): Chainable<any>
        changeNetwork(network: 'testnet4'|'scalenet'|'chipnet'|'mainnet'): Chainable<any>
    }
}