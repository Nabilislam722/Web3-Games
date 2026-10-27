// Hardhat setup for the Block Raid contracts. Network settings come from
// js/hemi-config.js, the same file the game reads.
import { configVariable, defineConfig } from 'hardhat/config';
import hardhatEthers from '@nomicfoundation/hardhat-ethers';
import hardhatNodeTestRunner from '@nomicfoundation/hardhat-node-test-runner';
import hardhatVerify from '@nomicfoundation/hardhat-verify';
import { HEMI_NETWORKS } from '../js/hemi-config.js';

// PRIVATE_KEY and the optional deploy settings can live in contracts/.env.
// Variables already set in the shell take precedence.
try {
  process.loadEnvFile(new URL('.env', import.meta.url));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

/** A live Hemi network. PRIVATE_KEY is only read when the network is used. */
const hemi = (net) => ({
  type: 'http',
  chainType: 'op', // Hemi is built on the OP Stack
  chainId: net.chainId,
  url: process.env.RPC_URL || net.rpc,
  accounts: [configVariable('PRIVATE_KEY')],
});

/** Hemi's explorers run Blockscout, which verifies source without an API key. */
const explorer = (net) => ({
  name: net.name,
  chainType: 'op',
  blockExplorers: { blockscout: { name: `${net.name} Explorer`, url: net.explorer, apiUrl: `${net.explorer}/api` } },
});

export default defineConfig({
  plugins: [hardhatEthers, hardhatNodeTestRunner, hardhatVerify],
  paths: { sources: 'src' },
  solidity: {
    version: '0.8.28',
    settings: {
      // Shanghai bytecode runs on Hemi and on local test chains alike.
      evmVersion: 'shanghai',
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    mainnet: hemi(HEMI_NETWORKS.mainnet),
    testnet: hemi(HEMI_NETWORKS.testnet),
    // The in-process chain that `npm run local` serves over HTTP.
    devnet: { type: 'edr-simulated', chainId: HEMI_NETWORKS.local.chainId },
  },
  chainDescriptors: {
    [HEMI_NETWORKS.mainnet.chainId]: explorer(HEMI_NETWORKS.mainnet),
    [HEMI_NETWORKS.testnet.chainId]: explorer(HEMI_NETWORKS.testnet),
  },
  verify: {
    blockscout: { enabled: true },
    etherscan: { enabled: false },
    sourcify: { enabled: true },
  },
});
