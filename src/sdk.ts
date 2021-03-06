import { providers } from '@0xsequence/multicall'
import { AMM, AMMRegistry, AMMRouterV1 } from '@apwine/amm'
import {
  Controller,
  Controller__factory,
  FutureVault,
  FutureVault__factory,
  PT__factory,
  Registry
} from '@apwine/protocol'
import { Provider } from '@ethersproject/providers'
import { BigNumberish, Signer } from 'ethers'
import {
  getAMMRegistryContract,
  getAMMRouterContract,
  getControllerContract,
  getRegistryContract
} from './contracts'
import {
  approve,
  deposit,
  fetchAllAMMs,
  fetchAllFutureAggregates,
  fetchAllFutureVaults,
  fetchAllowance,
  fetchAMM,
  fetchFutureAggregateFromAddress,
  fetchFutureAggregateFromIndex,
  isApprovalNecessary,
  updateAllowance,
  withdraw
} from './futures'
import { fetchFYTTokens } from './fyt'
import {
  addLiquidity,
  approveLPForAll,
  fetchAllLPTokenPools,
  fetchLPTokenPool,
  isLPApprovedForAll,
  removeLiquidity
} from './lp'
import { fetchSpotPrice, swap } from './swap'
import {
  AddLiquidityParams,
  APWToken,
  Network,
  Options,
  PairId,
  RemoveLiquidityParams,
  SDKOptions,
  SDKProps,
  SwapParams,
  WithOptional
} from './types'

class APWineSDK {
  /**
   * Await this propery to use asynchronous props, like Controller.
   * @async
   */
  ready: ReturnType<APWineSDK['initialize']> | boolean = false

  /**
   * The slippage tolerance being used by default on swaps.
   */
  defaultSlippage: number

  /**
   * The network the SDK instance is connected to.
   */
  network: Network

  /**
   * The provider, necessary for fetching data.
   */
  provider: Provider

  /**
   * The signer, necessary for executing transactions.
   */
  signer: Signer | null

  /**
   * Keep track of whether the signer or the provider is being used, when creating contract instances.
   */
  signerOrProvider: Signer | Provider

  /**
   * The default user which will be used in case no user is passed to certain functions.
   * The initial value will be the result of signer.getAddress()
   */
  defaultUser = ''

  /**
   * The AMM Registry contract instance. Keeps track of all AMMs.
   */
  AMMRegistry: AMMRegistry

  /**
   * The Registry contract instance. Keeps track of all utility contracts.
   */
  Registry: Registry

  /**
   * The AMM Router contract instance. Simplifies some processes through AMMs.
   */
  Router: AMMRouterV1

  /**
   * The Controller contract instance. Provides some basic flows, like withdraw/deposit.
   * @async
   */
  Controller: Controller | null = null

  /** Get a target FutureVault contract instance.
   * @param address - address of the desired Future.
   * @returns - FutureVault instance on the given address
   */
  FutureVault: (address: string) => FutureVault

  /**
   *Creates a new APWine SDK instance.
   * @param param0 - An object containing a network a spender,  a provider
     and an optional signer.
   */
  constructor(
    { network, provider, signer = null, defaultSlippage = 0.5 }: SDKProps,
    options: SDKOptions = { initialize: true }
  ) {
    this.provider = provider

    if (signer) {
      this.signer = signer
    }

    this.provider = new providers.MulticallProvider(provider)
    this.signer = signer

    this.signerOrProvider = this.signer ?? this.provider

    this.defaultSlippage = defaultSlippage
    this.network = network

    this.AMMRegistry = getAMMRegistryContract(this.signerOrProvider, network)
    this.Registry = getRegistryContract(this.signerOrProvider, network)
    this.Router = getAMMRouterContract(this.signerOrProvider, network)

    this.FutureVault = (address: string) =>
      FutureVault__factory.connect(address, this.signerOrProvider)

    if (options.initialize) {
      this.initialize()
    }
  }

  /**
   * Initializes all asynchronous properties, and sets the resulting promise in sdkInstance.ready
   * @returns - A Promise of a collection of asynchronous props wrapped into Promise.all
   */
  async initialize() {
    const ready = Promise.all([
      getControllerContract(this.signerOrProvider, this.network).then(
        (controller) => (this.Controller = controller)
      ),
      this.signer?.getAddress().then((address) => (this.defaultUser = address))
    ])

    this.ready = ready
    return ready
  }

  /**
   * Switch to signer usage on the sdk instance.
   * This is necessary if transactions are to be executed.
   */
  useSigner() {
    if (!this.signer) {
      console.error(
        'Error: signer is not provider, please use `updateSigner` to add a singer instance.'
      )

      return
    }

    if (!this.Controller) {
      console.error(
        "Error: The Controller instance hasn't been loaded yet. Wait for sdk.ready"
      )

      return
    }

    this.signerOrProvider = this.signer

    this.AMMRegistry = getAMMRegistryContract(
      this.signerOrProvider,
      this.network
    )
    this.Registry = getRegistryContract(this.signerOrProvider, this.network)
    this.Router = getAMMRouterContract(this.signerOrProvider, this.network)

    this.Controller = Controller__factory.connect(
      this.Controller!.address,
      this.signerOrProvider
    )
  }

  /**
   * Switch to provider usage on the sdk instance.
   * This is useful, when the priority is fetching. (utilizing MulticallProvider)
   */
  useProvider() {
    if (!this.Controller) {
      console.error(
        "Error: The Controller instance hasn't been loaded yet. Wait for sdk.ready"
      )

      return
    }

    this.signerOrProvider = this.provider

    this.AMMRegistry = getAMMRegistryContract(
      this.signerOrProvider,
      this.network
    )
    this.Registry = getRegistryContract(this.signerOrProvider, this.network)
    this.Router = getAMMRouterContract(this.signerOrProvider, this.network)

    this.Controller = Controller__factory.connect(
      this.Controller!.address,
      this.signerOrProvider
    )
  }

  /**
   * Update default user on an existing APWineSDK instance.
   * @param address - The address of the new user.
   */
  updateDefaultUser(address: string) {
    this.defaultUser = address
  }

  /**
   * Updates the provider on an existing APWineSDK instance.
   * @param provider - A provider to connect to the ethereum blockchain.
   * @param useWithContracts - 'Set this provider to sdk.signerOrProvider, and re-instantiate contract instances with it.'
   */
  updateProvider(provider: Provider, useWithContracts: boolean = false) {
    this.provider = provider

    if (useWithContracts) {
      this.useProvider()
    }
  }

  /**
   * Updates the network on an existing APWineSDK instance.
   * @param network - The network on which the SDK instance operates
   */
  updateNetwork(network: Network) {
    this.network = network
  }

  /**
   * Updates the signer on an existing APWineSDK instance.
   * @param signer - A transaction signer.
   * @param useWithContracts - 'Set this signer to sdk.signerOrProvider, and re-instantiate contract instances with it.'
   */
  updateSigner(signer: Signer, useWithContracts: boolean = true) {
    this.signer = signer

    if (useWithContracts) {
      this.useSigner()
    }
  }

  /**
   * Set default slippage tolerance for the SDK instance.
   * @param slippage - Default slippage to be set.
   */
  updateSlippageTolerance(slippage: number) {
    this.defaultSlippage = slippage
  }

  /**
   * Fetch the AMM of the provided FutureVault instance.
   * @param future - The target Future vault.
   * @returns - AMM contract instance.
   */
  async fetchAMM(future: FutureVault) {
    return fetchAMM(this.signerOrProvider, this.network, future)
  }

  /**
   * Fetch all AMMs
   * @returns - Promise of an AMM collection.
   */
  async fetchAllAMMs() {
    return fetchAllAMMs(this.signerOrProvider, this.network)
  }

  /**
   * Approve transactions for a token amount for the target token.
   * @param spender - The contract/entity receiving approval for spend.
   * @param tokenAddress - The address of the token contract.
   * @param amount - The amount of tokens to be approved.
   * @returns - an SDK returnType which contains a transaction and/or an error.
   * @transaction -  requires a signer.
   */
  async approve(spender: string, tokenAddress: string, amount: BigNumberish) {
    if (!this.signer) {
      console.error(
        'Error: This is a transaction, you need to have a signer defined. Use sdk.updateSigner() to proceed.'
      )
      return
    }

    return approve(this.signer, spender, tokenAddress, amount)
  }

  /**
   * Fetch the spendable amount by another party(spender) from the owner's tokens on a future vault
   * @param spender - The contract/entity to which the allowance is set.
   * @param tokenAddress - The address of the token contract.
   * @param account - The token owner's wallet address
   * @returns - The allowance in TokenAmount.
   */
  async allowance(spender: string, tokenAddress: string, account?: string) {
    return fetchAllowance(
      this.provider,
      this.network,
      account ?? this.defaultUser,
      spender,
      tokenAddress
    )
  }

  /**
   * Fetch an aggregated Future construct by future vault index.
   * @param index - The index of the future to be fetched.
   * @returns - An aggregated object with future related data.
   */
  async fetchFutureAggregateFromIndex(index: number) {
    return fetchFutureAggregateFromIndex(
      this.signerOrProvider,
      this.network,
      index
    )
  }

  /**
   * Fetch an aggregated Future construct by future vault address.
   * @param futureAddress - The address of the future to be fetched.
   * @returns - An aggregated object with future related data.
   */
  async fetchFutureAggregateFromAddress(futureAddress: string) {
    return fetchFutureAggregateFromAddress(
      this.signerOrProvider,
      this.network,
      futureAddress,
      this.Controller
    )
  }

  /**
   * Fetch all aggregated Future constructs on an AMM.
   * @returns - A collection of aggregated objects with future related data
   */
  async fetchAllFutureAggregates(amm: AMM) {
    return fetchAllFutureAggregates(this.signerOrProvider, this.network, amm)
  }

  /**
   * Fetch all future vaults.
   * @returns - All FutureVault instances.
   */
  async fetchAllFutureVaults() {
    return fetchAllFutureVaults(this.signerOrProvider, this.network)
  }

  /**
   * Check if the user needs to give approval to an entity, for an amount of a token.
   * @param tokenAddress - The address of the token.
   * @param amount - The amount in question.
   * @param spender - The entity of which the approval is being queried.
   * @param account - The owner of the tokens.
   * @returns - a boolean value.
   */
  async isApprovalNecessary(
    tokenAddress: string,
    amount: BigNumberish,
    spender: string,
    account?: string
  ) {
    return isApprovalNecessary(
      this.signerOrProvider,
      account ?? this.defaultUser,
      spender,
      tokenAddress,
      amount
    )
  }

  /**
   * Fetch PT token contract instance of an AMM.
   * @param amm - The target AMM.
   * @returns - PT token contract instance.
   */
  async fetchPT(amm: AMM) {
    const ptAddress = await amm.getPTAddress()
    return PT__factory.connect(ptAddress, this.signerOrProvider)
  }

  /**
   * Fetch all FYT contract instances.
   * @returns - a collection of FYT token contract instances.
   */
  async fetchAllFYTs() {
    return fetchFYTTokens(this.signerOrProvider, this.network)
  }

  /**
   * Inspect LPToken approval status of an account.
   * @param amm - The amm on which to check LPToken approval status.
   * @param account - The user whose approval status is queried.
   * @returns - a boolean value of the approval of this account for all LPs.
   */
  async isLPApprovedForAll(amm: AMM, account?: string) {
    return isLPApprovedForAll(this.provider, amm, account ?? this.defaultUser)
  }

  /**
   * Set LPToken approval status for an account.
   * @param amm - The AMM on which the approval will happen.
   * @param approval - Boolean value of the approval.
   * @returns - an SDK returnType which contains a transaction and/or an error.
   * @transaction -  requires a signer.
   */
  async approveLPForAll(amm: AMM, approval: boolean = true) {
    if (!this.signer) {
      console.error(
        'Error: This is a transaction, you need to have a signer defined. Use sdk.updateSigner() to proceed.'
      )
      return
    }

    return approveLPForAll(this.signer, amm, approval)
  }

  /**
   * Fetch an aggregated construct of an LPTokenPool
   * @param amm - The target AMM on which the tokenPool exists.
   * @param pairId - The pair id of the token pair, 0 or 1.
   * @param periodIndex - anything from 0 to the current period index. Default is the current period.
   * @returns - An aggregated construct with LPTokenPool related data.
   */
  async fetchLPTokenPool(amm: AMM, pairId: PairId, periodIndex?: number) {
    return fetchLPTokenPool(this.signerOrProvider, amm, pairId, periodIndex)
  }

  /**
   * Fetch an aggregated construct collection of all LPTokenPools.
   * @param amm - Fetch all liquidity pools of an AMM.
   * @returns - A collection of aggregated constructs with LPTokenPool related data.
   */
  async fetchAllLPTokenPools(amm: AMM) {
    return fetchAllLPTokenPools(this.signerOrProvider, amm)
  }

  /**
   * Add liqidity for the target AMM for a user.
   * @param params - AddLiquidityParams
   * @param Options
   * @returns - an SDK returnType which contains a transaction and/or an error.
   * @transaction -  requires a signer.
   */
  async addLiquidity(params: AddLiquidityParams, options?: Options) {
    if (!this.signer) {
      console.error(
        'Error: This is a transaction, you need to have a signer defined. Use sdk.updateSigner() to proceed.'
      )
      return
    }

    return addLiquidity({ signer: this.signer, ...params }, options)
  }

  /**
   * Remove liquidity from the target AMM for a user.
   * @param params - RemoveLiquidityParams
   * @param options
   * @returns - an SDK returnType which contains a transaction and/or an error.
   * @transaction -  requires a signer.
   */
  async removeLiquidity(params: RemoveLiquidityParams, options?: Options) {
    if (!this.signer) {
      console.error(
        'Error: This is a transaction, you need to have a signer defined. Use sdk.updateSigner() to proceed.'
      )
      return
    }

    return removeLiquidity({ signer: this.signer, ...params }, options)
  }

  /**
   * Update the spendable amount by another party(spender) from the owner's tokens on a future vault.
   * @param spender - The contract/entity for which the allowance will be updated.
   * @param tokenAddress - The address of the token contract.
   * @param amount - The amount of the allowance.
   * @param options
   * @returns - an SDK returnType which contains a transaction and/or an error.
   * @transaction -  requires a signer.
   */
  async updateAllowance(
    spender: string,
    tokenAddress: string,
    amount: BigNumberish,
    options = { autoApprove: false }
  ) {
    if (!this.signer) {
      console.error(
        'Error: This is a transaction, you need to have a signer defined. Use sdk.updateSigner() to proceed.'
      )
      return
    }

    if (options.autoApprove) {
      this.approve(spender, tokenAddress, amount)
    }

    return updateAllowance(this.signer, spender, tokenAddress, amount)
  }

  /**
   * Withdraw amount from a future vault.
   * @param future - The future to be withdrawn from.
   * @param amount - The amount to be withdrawn.
   * @param options
   * @returns - an SDK returnType which contains a transaction and/or an error.
   * @transaction -  requires a signer.
   */
  async withdraw(future: FutureVault, amount: BigNumberish) {
    if (!this.signer) {
      console.error(
        'Error: This is a transaction, you need to have a signer defined. Use sdk.updateSigner() to proceed.'
      )
      return
    }

    return withdraw(this.signer, this.network, future, amount, this.Controller)
  }

  /**
   * Deposit amount to a future vault.
   * @param future - The future to be withdrawn from.
   * @param amount - The amount to be withdrawn.
   * @param options
   * @returns - an SDK returnType which contains a transaction and/or an error.
   * @transaction -  requires a signer.
   */
  async deposit(
    future: FutureVault,
    amount: BigNumberish,
    options = { autoApprove: false }
  ) {
    if (!this.signer) {
      console.error(
        'Error: This is a transaction, you need to have a signer defined. Use sdk.updateSigner() to proceed.'
      )
      return
    }

    if (options.autoApprove && this.Controller) {
      const ibtAddress = await future.getIBTAddress()
      await this.approve(this.Controller.address, ibtAddress, amount)
    }

    return deposit(this.signer, this.network, future, amount, this.Controller)
  }

  /**
   * Fetch spot price of a swap route.
   * @param future - The target future on which the spot price is being queried.
   * @param from - APWToken: PT, Underlying or FYT.
   * @param to - APWToken: PT, Underlying or FYT.
   * @returns - spot price in BigNumber format.
   */
  fetchSpotPrice(future: FutureVault, from: APWToken, to: APWToken) {
    return fetchSpotPrice(this.provider, this.network, future, from, to)
  }

  /**
   * Swap by controlling the exact amount of tokens passed in.
   * @param params - SwapParams with optional slippageTolerance.
   * @param options
   * @returns - either an error object, or a ContractTransaction
   * @transaction -  requires a signer.
   */
  async swapIn(
    params: WithOptional<SwapParams, 'slippageTolerance'>,
    options: Options = { autoApprove: false }
  ) {
    if (!this.signer) {
      console.error(
        'Error: This is a transaction, you need to have a signer defined. Use sdk.updateSigner() to proceed.'
      )
      return
    }

    return swap(
      'IN',
      {
        slippageTolerance: this.defaultSlippage,
        signer: this.signer,
        network: this.network,
        ...params
      },
      options
    )
  }

  /**
   * Swap by controlling the exact amount of tokens coming out.
   * @param params - SwapParams with optional slippageTolerance.
   * @param options
   * @returns - either an error object, or a ContractTransaction
   * @transaction -  requires a signer.
   */
  async swapOut(
    params: WithOptional<SwapParams, 'slippageTolerance'>,
    options: Options = { autoApprove: false }
  ) {
    if (!this.signer) {
      console.error(
        'Error: This is a transaction, you need to have a signer defined. Use sdk.updateSigner() to proceed.'
      )
      return
    }

    return swap(
      'OUT',
      {
        slippageTolerance: this.defaultSlippage,
        signer: this.signer,
        network: this.network,
        ...params
      },
      options
    )
  }
}

export default APWineSDK
