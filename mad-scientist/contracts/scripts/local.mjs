// A local stand-in for Hemi: Hardhat's in-process chain served over HTTP, with
// a mock hBK whose fake Bitcoin chain advances on a timer, and the arena
// deployed on top. The addresses match the `local` network in js/hemi-config.js.
//
//   npm run local            then open the game with ?hemi=local
//   BTC_BLOCK_SECONDS=5 npm run local   faster fake Bitcoin blocks
import { network } from 'hardhat';
import { HDNodeWallet } from 'ethers';
import { HEMI_NETWORKS } from '../../js/hemi-config.js';

const local = HEMI_NETWORKS.local;
const PORT = Number(process.env.PORT || new URL(local.rpc).port);
const BLOCK_SECONDS = Number(process.env.BTC_BLOCK_SECONDS ?? 30);
const START_HEIGHT = Number(process.env.BTC_START_HEIGHT || 869_100);

const server = await network.createServer('devnet', '127.0.0.1', PORT);
const { port } = await server.listen();
const { ethers } = await network.create({ network: 'localhost', override: { url: `http://127.0.0.1:${port}` } });

const kit = await ethers.deployContract('MockBitcoinKit', [START_HEIGHT]);
const arena = await ethers.deployContract('MadScientistArena', [await kit.getAddress(), 144, 6]);
await arena.waitForDeployment();
for (const [label, c, want] of [['mock hBK', kit, local.bitcoinKit], ['arena', arena, local.arena]]) {
  const got = await c.getAddress();
  if (got.toLowerCase() !== want.toLowerCase()) console.warn(`! ${label} deployed at ${got}, but js/hemi-config.js expects ${want}`);
}

if (BLOCK_SECONDS > 0) {
  setInterval(async () => {
    try { await (await kit.mine(1)).wait(); } catch (e) { console.error('mine failed:', e.message); }
  }, BLOCK_SECONDS * 1000);
}

const raid = await arena.currentRaid();
console.log(`Local Hemi stand-in running on http://127.0.0.1:${port} (chain id ${local.chainId})
  mock hBK  ${await kit.getAddress()}
  arena     ${await arena.getAddress()}
  Bitcoin   height ${raid.tipHeight}, raid #${raid.raidId}${BLOCK_SECONDS > 0 ? `, one fake block every ${BLOCK_SECONDS}s` : ''}

Open the game with ?hemi=local, e.g. http://localhost:8000/?hemi=local
To submit scores, import this development-only key into a test wallet profile:
  ${HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', undefined, "m/44'/60'/0'/0/1").privateKey}
It is Hardhat's public default key. Never send real funds to it.`);

await server.afterClosed();
