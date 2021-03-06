import { BigNumber, BigNumberish, Signer } from 'ethers'
import {
  AToken__factory,
  Controller,
  FutureVault,
  FutureVault__factory
} from '@apwine/protocol'
import { Provider } from '@ethersproject/providers'
import range from 'ramda/src/range'
import { Token, TokenAmount } from '@uniswap/sdk'
import { AMM, AMMRegistry__factory, AMM__factory } from '@apwine/amm'
import {
  getAMMRegistryContract,
  getControllerContract,
  getFutureVaultContract,
  getRegistryContract,
  getTokenContract
} from './contracts'
import {
  error,
  getAddress,
  getNetworkChainId,
  getNetworkConfig
} from './utils/general'
import {
  FutureAggregate,
  Network,
  SDKFunctionReturnType,
  Transaction
} from './types'

export const fetchFutureAggregateFromIndex = async (
  signerOrProvider: Signer | Provider,
  network: Network,
  index: number
) => {
  const registry = getRegistryContract(signerOrProvider, network)
  const futureAddress = getAddress(
    await registry.getFutureVaultAt(BigNumber.from(index))
  )

  return fetchFutureAggregateFromAddress(
    signerOrProvider,
    network,
    futureAddress
  )
}

export const fetchFutureAggregateFromAddress = async (
  signerOrProvider: Signer | Provider,
  network: Network,
  address: string,
  controller?: Controller | null
): Promise<FutureAggregate> => {
  const _controller =
    controller ?? (await getControllerContract(signerOrProvider, network))
  const futureContract = getFutureVaultContract(signerOrProvider, address)

  const [
    amm,
    ibtAddress,
    ptAddress,
    period,
    platform,
    depositsPaused,
    withdrawalsPaused,
    nextPeriodIndex
  ] = await Promise.all([
    fetchAMM(signerOrProvider, network, futureContract),
    futureContract.getIBTAddress().then(getAddress),
    futureContract.getPTAddress().then(getAddress),
    futureContract.PERIOD_DURATION(),
    futureContract.PLATFORM_NAME(),
    _controller.isDepositsPaused(address),
    _controller.isWithdrawalsPaused(address),
    futureContract.getNextPeriodIndex()
  ])

  const nextPeriodTimestamp = await _controller.getNextPeriodStart(period)

  return {
    amm,
    vault: futureContract,
    address,
    ibtAddress,
    ptAddress,
    period,
    platform,
    depositsPaused,
    withdrawalsPaused,
    nextPeriodIndex,
    nextPeriodTimestamp
  }
}

export const fetchAllFutureAggregates = async (
  signerOrProvider: Signer | Provider,
  network: Network,
  amm: AMM
) => {
  const currentPeriodIndex = (await amm.currentPeriodIndex()).toNumber()
  return Promise.all(
    range(0, currentPeriodIndex).map((periodIndex) =>
      fetchFutureAggregateFromIndex(signerOrProvider, network, periodIndex)
    )
  )
}

export const fetchAllFutureVaults = async (
  signerOrProvider: Signer | Provider,
  network: Network
) => {
  const registry = getRegistryContract(signerOrProvider, network)
  const count = (await registry.futureVaultCount()).toNumber()

  const futureVaultAddresses = await Promise.all(
    range(0, count).map((index) => registry.getFutureVaultAt(index))
  )

  return Promise.all(
    futureVaultAddresses.map((address) =>
      FutureVault__factory.connect(address, signerOrProvider)
    )
  )
}

export const fetchAMM = async (
  signerOrProvider: Signer | Provider,
  network: Network,
  future: FutureVault
) => {
  const ammRegistry = AMMRegistry__factory.connect(
    getNetworkConfig(network).AMM_REGISTRY,
    signerOrProvider
  )
  const ammAddress = await ammRegistry.getFutureAMMPool(future.address)

  return AMM__factory.connect(ammAddress, signerOrProvider)
}

export const fetchAllAMMs = async (
  signerOrProvider: Signer | Provider,
  network: Network
) => {
  const ammRegistry = getAMMRegistryContract(signerOrProvider, network)
  const vaults = await fetchAllFutureVaults(signerOrProvider, network)

  const ammAddresses = await Promise.all(
    vaults.map((vault) => ammRegistry.getFutureAMMPool(vault.address))
  )

  return Promise.all(
    ammAddresses.map((address) =>
      AMM__factory.connect(address, signerOrProvider)
    )
  )
}

export const withdraw = async (
  signer: Signer,
  network: Network,
  future: FutureVault,
  amount: BigNumberish,
  controller?: Controller | null
): Promise<SDKFunctionReturnType<Transaction>> => {
  if (!signer) {
    return error('NoSigner')
  }

  const _controller =
    controller ?? (await getControllerContract(signer, network))
  const transaction = await _controller.withdraw(future.address, amount)

  return { transaction }
}

export const approve = async (
  signer: Signer,
  spender: string,
  tokenAddress: string,
  amount: BigNumberish
): Promise<SDKFunctionReturnType<Transaction>> => {
  if (!signer) {
    return error('NoSigner')
  }

  const account = await signer.getAddress()

  const needsApproval = isApprovalNecessary(
    signer,
    account,
    spender,
    tokenAddress,
    amount
  )

  if (!needsApproval) {
    return { transaction: undefined }
  }

  const token = getTokenContract(signer, tokenAddress)
  const transaction = await token.approve(spender, amount)

  return { transaction }
}

export const fetchAllowance = async (
  signerOrProvider: Signer | Provider,
  network: Network,
  owner: string,
  spender: string,
  tokenAddress: string
) => {
  const t = getTokenContract(signerOrProvider, tokenAddress)
  const allowance = await t.allowance(owner, spender)
  const decimals = await t.decimals()
  const token = new Token(getNetworkChainId(network), t.address, decimals)

  return new TokenAmount(token, allowance.toBigInt())
}

export const updateAllowance = async (
  signer: Signer,
  spender: string,
  tokenAddress: string,
  amount: BigNumberish
): Promise<SDKFunctionReturnType<Transaction>> => {
  if (!signer) {
    return error('NoSigner')
  }

  const token = getTokenContract(signer, tokenAddress)
  const bignumberAmount = BigNumber.from(amount)

  const transaction = await (bignumberAmount.isNegative()
    ? token.decreaseAllowance(spender, bignumberAmount)
    : token.increaseAllowance(spender, bignumberAmount.abs()))

  return {
    transaction
  }
}

export const deposit = async (
  signer: Signer,
  network: Network,
  future: FutureVault,
  amount: BigNumberish,
  controller?: Controller | null
): Promise<SDKFunctionReturnType<Transaction>> => {
  if (!signer) {
    return error('NoSigner')
  }

  const _controller =
    controller ?? (await getControllerContract(signer, network))

  const transaction = await _controller.deposit(future.address, amount)

  return { transaction }
}

export const isApprovalNecessary = async (
  signerOrProvider: Signer | Provider,
  account: string,
  spender: string,
  tokenAddress: string,
  amount: BigNumberish
) => {
  const token = AToken__factory.connect(tokenAddress, signerOrProvider)

  const allowance = await token.allowance(account, spender)

  return allowance.lt(amount)
}
