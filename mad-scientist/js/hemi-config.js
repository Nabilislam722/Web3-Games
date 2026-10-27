// Hemi network settings for Bitcoin Block Raids.
//
// `bitcoinKit` is Hemi's own hBK contract, already deployed on each network.
// `arena` is this game's leaderboard (contracts/src/MadScientistArena.sol).
// Paste its address here after running `npm run deploy:<network>` in contracts/. Until
// then, raids still work (their seed comes straight from hBK) but scores
// can't be submitted.

export const HEMI_NETWORKS = {
  mainnet: {
    name: 'Hemi',
    chainId: 43111,
    rpc: 'https://rpc.hemi.network/rpc',
    explorer: 'https://explorer.hemi.xyz',
    bitcoinKit: '0x7007dd1C09527B92AEcd8Ae6570B73d09E0B8F12',
    arena: '0x8A2Adb354DFC14B1778Ba92BCf4EA68cE5E15e84',
  },
  testnet: {
    name: 'Hemi Testnet',
    chainId: 743111,
    rpc: 'https://testnet.rpc.hemi.network/rpc',
    explorer: 'https://testnet.explorer.hemi.xyz',
    // Not the 0xeC9f…f215 in Hemi's docs: that older hBK has no getLastHeader().
    bitcoinKit: '0x181dBA19ce25bbD6d884347d2471FE5E5C0fcA4c',
    arena: '',
  },
  // `npm run local` in contracts/ starts this chain with a mock hBK. The
  // addresses are fixed because it deploys from Hardhat's default account.
  local: {
    name: 'Local devnet',
    chainId: 1337,
    rpc: 'http://127.0.0.1:8545',
    explorer: '',
    bitcoinKit: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    arena: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  },
};

/** Network used unless the page URL says otherwise, e.g. `?hemi=testnet`. */
export const DEFAULT_NETWORK = 'mainnet';

/** Bitcoin blocks per raid when no arena is deployed (the arena's own value wins). */
export const RAID_LENGTH = 144;
