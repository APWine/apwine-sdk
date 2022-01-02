import {
  Controller__factory,
  FutureVault__factory,
  Registry__factory
} from '@apwine/protocol'
import { AMM__factory } from '@apwine/amm'
import { Provider } from '@ethersproject/providers'
import { Signer } from 'ethers'
import { Network } from './constants'

import config from './config.json'

export const getRegistryContract = (
  signerOrProvider: Signer | Provider,
  network: Network
) =>
  Registry__factory.connect(
    config.networks[network].REGISTRY_ADDRESS,
    signerOrProvider
  )

export const getAMMContract = (
  signerOrProvider: Signer | Provider,
  network: Network
) =>
  AMM__factory.connect(config.networks[network].AMM_ADDRESS, signerOrProvider)

export const getControllerContract = async (
  signerOrProvider: Signer | Provider,
  network: Network

) => {
  const registry = getRegistryContract(signerOrProvider, network)
  const controllerAddress = await registry.getControllerAddress()

  return Controller__factory.connect(controllerAddress, signerOrProvider)
}

export const getFutureVaultContract = (
  signerOrProvider: Signer | Provider,
  address: string
) => FutureVault__factory.connect(address, signerOrProvider)
