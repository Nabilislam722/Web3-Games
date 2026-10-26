// Hemi network settings for Bitcoin Block Raids.
//
// `bitcoinKit` is Hemi's own hBK contract, already deployed on each network.
// `arena` is this game's leaderboard (contracts/src/MadScientistArena.sol).
// Paste its address here after running `npm run deploy` in contracts/. Until
// then, raids still work (their seed comes straight from hBK) but scores
// can't be submitted.

export const HEMI_NETWORKS = {
  mainnet: {
    name: 'Hemi',
    chainId: 43111,
    rpc: 'https://rpc.hemi.network/rpc',
    explorer: 'https://explorer.hemi.xyz',
    bitcoinKit: '0x7007dd1C09527B92AEcd8Ae6570B73d09E0B8F12',
    arena: '',
  },
  testnet: {
    name: 'Hemi Testnet',
    chainId: 743111,
    rpc: 'https://testnet.rpc.hemi.network/rpc',
    explorer: 'https://testnet.explorer.hemi.xyz',
    bitcoinKit: '0xeC9fa5daC1118963933e1A675a4EEA0009b7f215',
    arena: '',
  },
  // `npm run local` in contracts/ starts this chain with a mock hBK. The
  // addresses are fixed because it deploys from ganache's deterministic account.
  local: {
    name: 'Local devnet',
    chainId: 1337,
    rpc: 'http://127.0.0.1:8545',
    explorer: '',
    bitcoinKit: '0xe78A0F7E598Cc8b0Bb87894B0F60dD2a88d6a8Ab',
    arena: '0x5b1869D9A4C187F2EAa108f3062412ecf0526b24',
  },
};

/** Network used unless the page URL says otherwise, e.g. `?hemi=testnet`. */
export const DEFAULT_NETWORK = 'mainnet';

/** Bitcoin blocks per raid when no arena is deployed (the arena's own value wins). */
export const RAID_LENGTH = 144;
