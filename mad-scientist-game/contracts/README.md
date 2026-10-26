# Block Raid contracts (Hemi)

The leaderboard behind **Bitcoin Block Raids**. Hemi's hVM runs a Bitcoin
node inside every Hemi node, and its hBK contract lets Solidity read Bitcoin
block headers. This contract uses that to tie each raid to Bitcoin:

- Bitcoin time is split into raids of 144 blocks (about a day).
- A raid's **seed is the hash of the Bitcoin block that opens it**, read
  on-chain with `getHeaderN`. The game turns that hash into the raid's enemy
  lineup, starting zone and daily modifier. Every player gets the same raid,
  and nobody can know it before miners produce that block.
- `submitScore` keeps each player's best run per raid and a top-10 board, and
  stamps every entry with the Bitcoin height hVM saw when it was recorded.
  Runs are accepted for the live raid, or for the previous one during a
  6-block grace period.

Scores are reported by the game client and are not verified on-chain, so treat
the board as a friendly competition, not a prize ledger.

| File | What it is |
| --- | --- |
| `src/MadScientistArena.sol` | Raids, seeds and leaderboards |
| `src/IBitcoinKit.sol` | The part of Hemi's hBK interface the arena uses |
| `src/test/MockBitcoinKit.sol` | Fake Bitcoin chain for tests and local play |
| `scripts/deploy.mjs` | Deploys the arena to Hemi testnet or mainnet |
| `scripts/local.mjs` | Local chain with the mock hBK, for playing raids offline |
| `test/` | Contract tests, plus tests of the game's web3 client (`../js/hemi.js`) |

## Setup

Needs Node 20 or newer.

```bash
cd mad-scientist-game/contracts
npm install
npm test
```

The tests compile with `solc` and run on an in-process ganache chain, so no
other toolchain is required.

## Deploy to Hemi

1. Get ETH on Hemi for gas. On testnet use the faucet linked from the
   [Hemi docs](https://docs.hemi.xyz/discover/network-details); on mainnet
   bridge with the [Hemi Tunnel](https://app.hemi.xyz/en/tunnel/). Deploying
   costs about 1.0M gas and each score submission 125k–200k gas.
2. Deploy:

   ```bash
   PRIVATE_KEY=0x... npm run deploy -- testnet   # or mainnet
   ```

   The script first checks that hBK answers on that network and prints the
   Bitcoin height hVM sees, then deploys and prints the arena address.
3. Paste the address into `arena` for that network in `../js/hemi-config.js`.
   Set `DEFAULT_NETWORK` there to the network players should use, or link to
   the game with `?hemi=testnet` / `?hemi=mainnet`.

Optional environment variables: `RPC_URL` for another RPC provider,
`RAID_LENGTH` (Bitcoin blocks per raid, default 144) and `GRACE_BLOCKS`
(default 6). Hemi testnet follows Bitcoin testnet, whose block times vary a lot,
so raids there can be much shorter or longer than a day.

## Play raids locally

```bash
npm run local                    # one fake Bitcoin block every 30 s
BTC_BLOCK_SECONDS=5 npm run local
```

This starts a chain on `http://127.0.0.1:8545` (chain id 1337) with the mock
hBK and the arena at the addresses already listed under `local` in
`hemi-config.js`. Serve the repository root and open the game with
`?hemi=local`. To submit scores, import the printed development key into a
test wallet profile. It is ganache's public demo key, so never use it with
real funds.

## hBK reference

| Network | Chain id | hBK |
| --- | --- | --- |
| Hemi | 43111 | `0x7007dd1C09527B92AEcd8Ae6570B73d09E0B8F12` |
| Hemi testnet | 743111 | `0xeC9fa5daC1118963933e1A675a4EEA0009b7f215` |

From the [hBK docs](https://docs.hemi.xyz/building-bitcoin-apps/hemi-bitcoin-kit-hbk/hbk-smart-contract):
`getLastHeader()` wraps hVM precompile `0x44` and `getHeaderN(uint32)` wraps
`0x45`.
