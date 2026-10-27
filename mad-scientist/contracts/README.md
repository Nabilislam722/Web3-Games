# Block Raid contracts (Hemi)

The leaderboard behind **Bitcoin Block Raids**. Hemi's hVM runs a Bitcoin
node inside every Hemi node, and its hBK contract lets Solidity read Bitcoin
block headers. This contract uses that to tie each raid to Bitcoin:

- Bitcoin time is split into raids of 144 blocks (about a day).
- A raid's **seed is a Bitcoin block hash recorded on-chain**. The first time
  a raid is touched, by its first score or by `openRaid()` (anyone can call
  it), the arena stores the hash of the newest Bitcoin block hVM knows
  (`getLastHeader`). The game turns that hash into the raid's enemy lineup,
  starting zone and daily modifier. Once a raid is opened, every player gets
  the same raid, and nobody could have known it before miners produced that
  block.
- Until a raid is opened, `currentRaid()` reports the newest block's hash as a
  provisional seed (`opened` is false), so its lineup can change with each new
  Bitcoin block until the first score locks it in.
- `submitScore` keeps each player's best run per raid and a top-10 board, and
  stamps every entry with the Bitcoin height hVM saw when it was recorded.
  Runs are accepted for the live raid, or for the previous one during a
  6-block grace period.

Scores are reported by the game client and are not verified on-chain, so treat
the board as a friendly competition, not a prize ledger. For the same reason,
whoever opens a raid could wait for a Bitcoin block whose lineup they like.

Seeds are recorded rather than read back from the block that started the
raid, because hVM doesn't currently serve older Bitcoin headers (see
[hBK reference](#hbk-reference)).

| File | What it is |
| --- | --- |
| `src/MadScientistArena.sol` | Raids, seeds and leaderboards |
| `src/IBitcoinKit.sol` | The part of Hemi's hBK interface the arena uses |
| `src/test/MockBitcoinKit.sol` | Fake Bitcoin chain for tests and local play |
| `hardhat.config.js` | Compiler settings and the Hemi networks (read from `../js/hemi-config.js`) |
| `scripts/deploy.mjs` | Deploys the arena to Hemi testnet or mainnet |
| `scripts/verify.mjs` | Publishes the deployed arena's source on the Hemi explorer |
| `scripts/local.mjs` | Local chain with the mock hBK, for playing raids offline |
| `test/` | Contract tests, plus tests of the game's web3 client (`../js/hemi.js`) |

## Setup

Built with [Hardhat 3](https://hardhat.org). Needs Node 22.13 or newer.

```bash
cd mad-scientist/contracts
npm install
npm test        # compiles, then runs the tests on Hardhat's in-process chain
npm run build   # compile only
```

## Deploy to Hemi

1. Get ETH on Hemi for gas. On testnet use the faucet linked from the
   [Hemi docs](https://docs.hemi.xyz/discover/network-details); on mainnet
   bridge with the [Hemi Tunnel](https://app.hemi.xyz/en/tunnel/). Deploying
   costs about 1.1M gas and each score submission 125k–200k gas. The first
   score of a raid also stores its seed, which brings it to about 220k.
2. Put the deployer key in `contracts/.env` (git-ignored), or set
   `PRIVATE_KEY` in the environment, which takes precedence:

   ```bash
   PRIVATE_KEY=0x...
   ```

   Then deploy:

   ```bash
   npm run deploy:testnet   # or npm run deploy:mainnet
   ```

   The script first checks that hBK answers `getLastHeader`, the one call the
   arena makes, and prints the Bitcoin height hVM sees. It stops before
   sending anything if that fails. Then it deploys and prints the arena
   address.
3. Paste the address into `arena` for that network in `../js/hemi-config.js`.
   Set `DEFAULT_NETWORK` there to the network players should use, or link to
   the game with `?hemi=testnet` / `?hemi=mainnet`.
4. Publish the source:

   ```bash
   npm run verify:testnet   # or npm run verify:mainnet
   ```

   It verifies the `arena` address from step 3 (or `ARENA=0x...` if set) on
   [Sourcify](https://sourcify.dev) and on the Hemi explorer. It needs no API
   key or `PRIVATE_KEY`, and it reads the constructor arguments from the
   deployed contract. Running it again on a verified contract is harmless.

   Hemi's explorer may refuse uploads through its API with
   `403: Forbidden`. In that case the script writes the exact compiler input
   to `artifacts/verification/` and prints the values to enter on the
   explorer's verification page (method *Solidity (Standard JSON input)*).

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
`hemi-config.js`. Serve the `mad-scientist` folder and open the game with
`?hemi=local`. To submit scores, import the printed development key into a
test wallet profile. It is Hardhat's public default key, so never use it with
real funds.

## hBK reference

| Network | Chain id | hBK |
| --- | --- | --- |
| Hemi | 43111 | `0x7007dd1C09527B92AEcd8Ae6570B73d09E0B8F12` |
| Hemi testnet | 743111 | `0x181dBA19ce25bbD6d884347d2471FE5E5C0fcA4c` |

From the [hBK docs](https://docs.hemi.xyz/building-bitcoin-apps/hemi-bitcoin-kit-hbk/hbk-smart-contract):
`getLastHeader()` wraps hVM precompile `0x44` and `getHeaderN(uint32)` wraps
`0x45`. The arena only uses `getLastHeader()`.

Status as of 27 October 2026, checked against several public RPC providers:

- Precompile `0x45` returns nothing for any height on mainnet or testnet, so
  `getHeaderN` reverts with "Failed to retrieve specified Bitcoin header".
  That is why raids record their seed instead of reading the header of the
  block that started them.
- The testnet hBK the docs list, `0xeC9fa5daC1118963933e1A675a4EEA0009b7f215`,
  is an older BitcoinKit with differently named functions (`btcLastHeader`,
  …), so `getLastHeader()` reverts on it. The address above is a newer
  verified BitcoinKit; `0xb5650190A1bED94458c994E0526515ca4488e8B3` works the
  same way.
