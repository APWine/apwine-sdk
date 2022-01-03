import { BigNumberish, Signer } from 'ethers'
import { Provider } from '@ethersproject/providers'
import { providers } from '@0xsequence/multicall'
import { Controller, FutureVault, FutureYieldToken, PT, Registry } from '@apwine/protocol'
import { AMM, LPToken } from '@apwine/amm'
import { Network, PairId } from './constants'

import {
  deposit,
  fetchAllFutureAggregates,
  fetchAllFutureVaults,
  fetchFutureAggregateFromIndex,
  fetchFutureAggregateFromAddress,
  withdraw,
  fetchFutureToken,
  updateAllowance,
  approve,
  fetchAllowance
} from './futures'
import { approveLPForAll, fetchAllLPTokenPools, fetchLPTokenPool, getLPTokenContract, isLPApprovedForAll } from './lp'
import {
  getAMMContract,
  getControllerContract,
  getRegistryContract
} from './contracts'
import { fetchPTTokens } from './pt'
import { fetchFYTTokens } from './fyt'

type ConstructorProps = {
  network: Network
  provider: Provider
  spender: string
  signer?: Signer
}

class APWineSDK {
  ready: ReturnType<APWineSDK['initialize']>

  network: Network
  provider: Provider
  spender: string;
  signer?: Signer

  AMM: AMM
  Registry: Registry

  // async props
  PTs: PT[] | null = null
  FYTs: FutureYieldToken[] | null = null
  LP: LPToken | null = null
  Controller: Controller | null = null
  vaults: FutureVault[] | null = null

  /**
   *Creates a new APWine SDK instance.
   * @param param0{ConstructorProps} - An object containing a network a spender,  a provider
     and an optional signer.
   */
  constructor({ network, signer, provider, spender }: ConstructorProps) {
    this.provider = new providers.MulticallProvider(provider)
    this.network = network
    this.spender = spender

    if (signer) {
      this.signer = signer
    }

    this.AMM = getAMMContract(provider, network)
    this.Registry = getRegistryContract(provider, network)

    this.ready = this.initialize()
  }

  /**
   * Initializes all asynchronous properties, and sets the resulting promise in this.asyncProps
   * @returns - A Promise of a collection of asynchronous props wrapped into Promise.all
   */
  private async initialize() {
    return Promise.all([
      getControllerContract(this.provider, this.network).then(
        controller => (this.Controller = controller)
      ),
      fetchPTTokens(this.provider, this.network).then((pts) => (this.PTs = pts)),
      fetchFYTTokens(this.provider, this.network).then((fyts) => (this.FYTs = fyts)),
      this.AMM.getPoolTokenAddress().then((lpTokenAddress) =>
        (this.LP = getLPTokenContract(this.provider, lpTokenAddress))
      ),
      fetchAllFutureVaults(this.provider, this.network).then((vaults) => (
        this.vaults = vaults
      ))
    ])
  }

  /**
  * Updates the provider on an existing APWineSDK instance.
   * @param provider - A provider to connect to the ethereum blockchain.
   */
  updateProvider(provider: Provider) {
    this.provider = provider
  }

  /**
   * Updates the network on an existing APWineSDK instance.
   * @param network{Network} - The network on which the SDK instance operates
   */
  updateNetwork(network: Network) {
    this.network = network
  }

  /**
  * Updates the signer on an existing APWineSDK instance.
   * @param signer - A transaction signer.
   */
  updateSigner(signer: Signer) {
    this.signer = signer
  }

  /**
   * Updates the primary spender on an existing APWineSDK instance.
   * @param spender -  The primary spender
   */
  updateSpender(spender: string) {
    this.spender = spender
  }

  /**
   * Approve transactions for a token amount on the target future vault.
   * @param future - The target future vault.
   * @param amount - The amunt of tokens to be approved.
   * @param spender - The spender of the token amount.

   * @returns - Either an error, or a transaction receipt.
   */
  async approve(future: FutureVault, amount: BigNumberish, spender: string = this.spender) {
    return approve(this.signer, spender, future, amount)
  }

  /**
   * Fetch the spendable amount by another party(spender) from the owners tokens on a certain future vault
   * @param owner - The token owner's wallet address
   * @param future - The future on which the allowance is set.
   * @param spender - The entity which the allowance belongs to.
   * @returns - The allowance in TokenAmount.
   */
  async fetchAllowance(owner: string, future: FutureVault, spender: string = this.spender) {
    return fetchAllowance(this.provider, owner, spender, future)
  }

  /**
   * Fetch an aggregated Future construct by future vault index.
   * @param index - The index of the future to be fetched.
   * @returns - An aggregated object with future related data.
   */
  async fetchFutureAggregateFromIndex(index: number) {
    return fetchFutureAggregateFromIndex(this.network, this.provider, index)
  }

  /**
   * Fetch an aggregated Future construct by future vault address.
   * @param futureAddress - The address of the future to be fetched.
   * @returns - An aggregated object with future related data.
   */
  async fetchFutureAggregateFromAddress(futureAddress: string) {
    return fetchFutureAggregateFromAddress(this.network, this.provider, futureAddress)
  }

  /**
   * Fetch all aggregated Future constructs.
   * @returns - A collection of aggregated objects with future related data
   */
  async fetchAllFutureAggregates() {
    return fetchAllFutureAggregates(this.provider, this.network)
  }

  /**
   * Fetch the token of a future vault instance.
   * @param future - The target future vault instance.
   * @returns {AToken} - A token instance of the future vault.
   */
  async fetchFutureToken(future: FutureVault) {
    return fetchFutureToken(this.provider, future)
  }

  /**
   * Inspect LPToken approval status of an account.
   * @param account - The account's approval to be checked.
   * @param operator - The operator the approval is given to.
   * @returns {boolean}
   */
  async isLPApprovedForAll(account: string, operator: string) {
    return isLPApprovedForAll(this.provider, this.network, account, operator)
  }

  /**
   * Set LPToken approval status for an account.
   * @param account - The account's approval to be set.
   * @param approval - Boolean value of the approval.
   * @returns
   */
  async approveLPForAll(account: string, approval: boolean = true) {
    return approveLPForAll(this.signer, this.network, account, approval)
  }

  /**
   * Fetch an aggregated construct of an LPTokenPool
   * @param pairId - 0 or 1
   * @param periodIndex anything from 0 to the current period index. Default is the current period.
   * @returns - An aggregated construct with LPTokenPool related data.
   */
  async fetchLPTokenPool(pairId: PairId, periodIndex?: number) {
    return fetchLPTokenPool(this.provider, this.network, pairId, periodIndex)
  }

  /**
   * Fetch an aggregated construct collection of all LPTokenPools.
   * @returns - A collection of aggregated constructs with LPTokenPool related data.
   */
  async fetchAllLPTokenPools() {
    return fetchAllLPTokenPools(this.network, this.provider)
  }

  /**
  * Update the spendable amount by another party(spender) from the owners tokens on a certain future vault.
  * @param future - The future on which the allowance is being set.
  * @param amount - The amount of the allowance.
  * @param spender - The entity which is able to spend from the owners tokens.
  * @returns - Either an error, or the Transaction receipt.
  */
  async updateAllowance(future: FutureVault, amount: BigNumberish, spender: string = this.spender) {
    return updateAllowance(this.signer, spender, future, amount)
  }

  /**
   * Withdraw amount from a future vault.
   * @param future - The future to be withdrawn from.
   * @param amount - The amount to be withdrawn.
   * @param autoApprove - Approve automatically in case it's necessary.
   * @param spender - The account signing the withdrawal.
   * @returns - Either an error, or the Transaction receipt.
   */
  async withdraw(future: FutureVault, amount: BigNumberish, autoApprove: boolean = false, spender = this.spender) {
    if (autoApprove) {
      await this.approve(future, amount, spender)
    }

    return withdraw(this.signer, this.network, future, amount)
  }

  /**
   * Deposit amount to a future vault.
   * @param future - The future to be withdrawn from.
   * @param amount - The amount to be withdrawn.
   * @param autoApprove - Approve automatically in case it's necessary.
   * @param spender - The account signing the deposit
   * @returns - Either an error, or the Transaction receipt.
   */
  async deposit(future: FutureVault, amount: BigNumberish, autoApprove: boolean = false, spender = this.spender) {
    if (autoApprove) {
      await this.approve(future, amount, spender)
    }

    return deposit(this.signer, this.network, future, amount)
  }
}

export default APWineSDK
