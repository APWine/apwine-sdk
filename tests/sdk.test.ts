import path from 'path'
import dotenv from 'dotenv'
import { BigNumber, ethers, providers, Signer } from 'ethers'
import { JsonRpcProvider } from '@ethersproject/providers'
import { parseEther, parseUnits } from 'ethers/lib/utils'
import APWineSDK from '../src/sdk'
import { getTokenContract } from '../src/contracts'
import { isError } from '../src/utils/general'

jest.setTimeout(30000)

describe('APWineSDK', () => {
  describe.only('mainnet', () => {
    let provider: JsonRpcProvider, signer: Signer, sdk: APWineSDK

    beforeAll(() => {
      dotenv.config({ path: path.resolve(__dirname, '../.env') })

      // url = `https://eth-kovan.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`
      provider = new providers.JsonRpcProvider(
        `https://rpc.tenderly.co/fork/${process.env.TENDERLY_MAINNET_FORK_ID}`,
        'mainnet'
      )

      signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider)
    })
    afterAll(async () => {
      await sdk.ready

      const [amm] = await sdk.fetchAllAMMs()

      sdk.swapIn(
        { from: 'Underlying', to: 'PT', amm, amount: parseUnits('20', 18) },
        { autoApprove: true }
      )
    })

    beforeEach(() => {
      sdk = new APWineSDK({
        provider,
        signer,
        network: 'mainnet'
      })
    })

    it('should keep track of the signer and provider', async () => {
      await sdk.ready

      sdk.useSigner()
      expect(sdk.signerOrProvider).toBe(sdk.signer)

      sdk.useProvider()
      expect(sdk.signerOrProvider).toBe(sdk.provider)
    })

    it('should set the signer or the provider to all contract instances, on change.', async () => {
      await sdk.ready

      sdk.useProvider()

      expect(sdk.AMMRegistry.signer).toBeNull()
      expect(sdk.Registry.signer).toBeNull()
      expect(sdk.Controller?.signer).toBeNull()
      expect(sdk.Router.signer).toBeNull()

      sdk.useSigner()

      expect(sdk.AMMRegistry.signer).toBe(sdk.signer)
      expect(sdk.Registry.signer).toBe(sdk.signer)
      expect(sdk.Controller?.signer).toBe(sdk.signer)
      expect(sdk.Router.signer).toBe(sdk.signer)
    })

    it('should have the network set', async () => {
      expect(sdk.network).toBe('mainnet')
    })

    it('should have the signer or provider set', async () => {
      expect(sdk.provider).toBeDefined()
    })

    it('should have the registry instance set', async () => {
      expect(sdk.Registry).toBeDefined()
    })

    it('should  have the Controller contract instance set after asyncProps are loaded', async () => {
      expect(sdk.Controller).toBeNull()
      await sdk.ready
      expect(sdk.Controller).toBeDefined()
    })

    it('should be able to fetch all AMMs', async () => {
      await sdk.ready

      const amms = await sdk.fetchAllAMMs()

      expect(amms.map((amm) => amm.address)).toEqual([
        '0x8A362AA1c81ED0Ee2Ae677A8b59e0f563DD290Ba',
        '0xc61C0F4961F2093A083f47a4b783ad260DeAF7eA',
        '0x1604C5e9aB488D66E983644355511DCEF5c32EDF',
        '0xA4085c106c7a9A7AD0574865bbd7CaC5E1098195',
        '0x0CC36e3cc5eACA6d046b537703ae946874d57299',
        '0x839Bb033738510AA6B4f78Af20f066bdC824B189',
        '0xb932c4801240753604c768c991eb640BCD7C06EB',
        '0x49CbBFEDB15B5C22cac53Daf104512a5DE9C8457',
        '0xcbA960001307A16ce8A9E326D73e92D53b446E81',
        '0xbC35b70ccc8Ef4Ec1ccc34FaB60CcBBa162011e4'
      ])
    })

    it('Should be able to swapIn', async () => {
      await sdk.ready

      const [amm] = await sdk.fetchAllAMMs()

      const ptAddress = await amm.getPTAddress()
      const token = await getTokenContract(sdk.provider, ptAddress)
      const user = await signer.getAddress()
      const balance = await token.balanceOf(user)
      const swap = await sdk.swapIn(
        { from: 'PT', to: 'Underlying', amm, amount: parseUnits('10', 18) },
        { autoApprove: true }
      )

      await swap?.transaction?.wait()

      const newBalance = await token.balanceOf(user)

      expect(balance.gt(newBalance)).toBeTruthy()
    })

    it.skip('Should be able to swapOut', async () => {
      await sdk.ready

      const [amm] = await sdk.fetchAllAMMs()

      const ptAddress = await amm.getPTAddress()
      const token = await getTokenContract(sdk.provider, ptAddress)
      const user = await signer.getAddress()
      const balance = await token.balanceOf(user)

      const swap = await sdk.swapOut(
        { from: 'PT', to: 'Underlying', amm, amount: parseUnits('10', 18) },
        { autoApprove: true }
      )
      await swap?.transaction?.wait()

      const newBalance = await token.balanceOf(user)

      expect(balance.gt(newBalance)).toBeTruthy()
    })

    it('should be able to add liquidity', async () => {
      await sdk.ready

      const [amm] = await sdk.fetchAllAMMs()

      const user = await signer.getAddress()
      const lp = await sdk.fetchLPTokenPool(amm, 0)

      const balance = await lp.token.balanceOf(user, lp.id)

      const { transaction } =
        (await sdk.addLiquidity(
          {
            amm,
            pairId: 0,
            amount: parseEther('0.1')
          },
          { autoApprove: true }
        )) ?? {}

      await transaction?.wait()

      const newBalance = await lp.token.balanceOf(user, lp.id)

      expect(balance.lt(newBalance)).toBeTruthy()
    })

    it('should be able to remove liquidity', async () => {
      await sdk.ready

      const [amm] = await sdk.fetchAllAMMs()

      const user = await signer.getAddress()
      const lp = await sdk.fetchLPTokenPool(amm, 0)

      const balance = await lp.token.balanceOf(user, lp.id)

      const { transaction } =
        (await sdk.removeLiquidity(
          {
            amm,
            pairId: 0,
            amount: parseEther('0.1')
          },
          { autoApprove: true }
        )) ?? {}

      await transaction?.wait()

      const newBalance = await lp.token.balanceOf(user, lp.id)

      expect(balance.gt(newBalance)).toBeTruthy()
    })

    it('should be able to fetch spot price.', async () => {
      const vaults = await sdk.fetchAllFutureVaults()
      const result = await sdk.fetchSpotPrice(vaults[0], 'PT', 'Underlying')

      if (isError(result)) {
        // eslint-disable-next-line no-undef
        fail()
      }

      expect(result.gt(0)).toBeTruthy()
    })
  })

  describe('polygon', () => {
    let provider: JsonRpcProvider, signer: Signer, sdk: APWineSDK

    beforeAll(() => {
      dotenv.config({ path: path.resolve(__dirname, '../.env') })

      // url = `https://eth-kovan.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`
      provider = new providers.JsonRpcProvider(
        `https://rpc.tenderly.co/fork/${process.env.TENDERLY_POLYGON_FORK_ID}`,
        'matic'
      )

      signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider)
    })

    beforeEach(() => {
      sdk = new APWineSDK({
        provider,
        signer,
        network: 'polygon'
      })
    })

    it('should be able to fetch all AMMS', async () => {
      const ammAddresses = (await sdk.fetchAllAMMs()).map((amm) => amm.address)

      expect(ammAddresses).toEqual([
        '0x8A362AA1c81ED0Ee2Ae677A8b59e0f563DD290Ba',
        '0xc61C0F4961F2093A083f47a4b783ad260DeAF7eA',
        '0x1604C5e9aB488D66E983644355511DCEF5c32EDF',
        '0xc68B6987075944f9E8b0a6c2b52e923BC1fb9028',
        '0x7429e160aA4ab7BbeC65C101bD2624C8cba8A2f6',
        '0x91e94E5e3baa054F92BAC48a9C05e6228dE1fcac'
      ])
    })
  })
})
