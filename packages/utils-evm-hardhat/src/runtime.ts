import type { HardhatRuntimeEnvironment, EIP1193Provider } from 'hardhat/types'

import pMemoize from 'p-memoize'
import { Web3Provider } from '@ethersproject/providers'
import { ConfigurationError } from './errors'
import { HardhatContext } from 'hardhat/internal/context'
import { Environment as HardhatRuntimeEnvironmentImplementation } from 'hardhat/internal/core/runtime-environment'
import { EndpointId } from '@layerzerolabs/lz-definitions'
import { EndpointBasedFactory } from '@layerzerolabs/utils-evm'

/**
 * Helper type for when we need to grab something asynchronously by the network name
 */
export type GetByNetwork<TValue> = (networkName: string) => Promise<TValue>

/**
 * Creates a clone of the HardhatRuntimeEnvironment for a particular network
 *
 * ```typescript
 * const env = getEnvironment("bsc-testnet");
 *
 * // All the ususal properties are present
 * env.deployments.get("MyContract")
 * ```
 *
 */
export const getNetworkRuntimeEnvironment: GetByNetwork<HardhatRuntimeEnvironment> = pMemoize(async (networkName) => {
    // The first step is to get the hardhat context
    //
    // Context is registered globally as a singleton and can be accessed
    // using the static methods of the HardhatContext class
    //
    // In our case we require the context to exist, the other option would be
    // to create it and set it up - see packages/hardhat-core/src/register.ts for an example setup
    let context: HardhatContext
    try {
        context = HardhatContext.getHardhatContext()
    } catch (error: unknown) {
        throw new ConfigurationError(`Could not get Hardhat context: ${error}`)
    }

    // We also require the hardhat environment to already exist
    //
    // Again, we could create it but that means we'd need to duplicate the bootstrap code
    // that hardhat does when setting up the environment
    let environment: HardhatRuntimeEnvironment
    try {
        environment = context.getHardhatRuntimeEnvironment()
    } catch (error: unknown) {
        throw new ConfigurationError(`Could not get Hardhat Runtime Environment: ${error}`)
    }

    try {
        // The last step is to create a duplicate enviornment that mimics the original one
        // with one crucial difference - the network setup
        return new HardhatRuntimeEnvironmentImplementation(
            environment.config,
            {
                ...environment.hardhatArguments,
                network: networkName,
            },
            environment.tasks,
            environment.scopes,
            context.environmentExtenders,
            context.experimentalHardhatNetworkMessageTraceHooks,
            environment.userConfig,
            context.providerExtenders
            // This is a bit annoying - the environmentExtenders are not stronly typed
            // so TypeScript complains that the properties required by HardhatRuntimeEnvironment
            // are not present on HardhatRuntimeEnvironmentImplementation
        ) as unknown as HardhatRuntimeEnvironment
    } catch (error: unknown) {
        throw new ConfigurationError(`Could not setup Hardhat Runtime Environment: ${error}`)
    }
})

/**
 * Helper function that wraps an EIP1193Provider with Web3Provider
 * so that we can use it further with ethers
 *
 * @param provider `EIP1193Provider`
 * @returns `Web3Provider`
 */
export const wrapEIP1193Provider = (provider: EIP1193Provider): Web3Provider => new Web3Provider(provider)

/**
 * Creates a factory function for creating HardhatRuntimeEnvironment
 * based on a hardhat config and an EndpointId
 *
 * ```typescript
 * import hre from "hardhat";
 *
 * const factory = createNetworkEnvironmentFactory(hre);
 * const env = factory(EndpointId.FANTOM_MAINNET)
 * ```
 *
 * @param hre `HardhatRuntimeEnvironment`
 * @returns `(eid: EndpointId) => Promise<HardhatRuntimeEnvironment>`
 */
export const createNetworkEnvironmentFactory = (
    hre: HardhatRuntimeEnvironment
): EndpointBasedFactory<HardhatRuntimeEnvironment> => {
    const networks = Object.entries(hre.config.networks)
    const networkNamesByEndpointId: Map<EndpointId, string> = new Map(
        networks.flatMap(([networkName, { endpointId }]) => {
            if (endpointId == null) return []

            return [[endpointId, networkName]]
        })
    )

    return async (eid) => {
        const networkName = networkNamesByEndpointId.get(eid)
        if (networkName == null) throw new Error(`No network defined for eid ${eid}`)

        return getNetworkRuntimeEnvironment(networkName)
    }
}
