// A local stand-in for Hemi: a ganache chain with a mock hBK whose fake
// Bitcoin chain advances on a timer, and the arena deployed on top.
// The addresses match the `local` network in js/hemi-config.js.
//
//   npm run local            then open the game with ?hemi=local
//   BTC_BLOCK_SECONDS=5 npm run local   faster fake Bitcoin blocks
import ganache from 'ganache';
import { ethers } from 'ethers';
import { compile } from './compile.mjs';
import { HEMI_NETWORKS } from '../../js/hemi-config.js';

const PORT = Number(process.env.PORT || 8545);
const BLOCK_SECONDS = Number(process.env.BTC_BLOCK_SECONDS ?? 30);
const START_HEIGHT = Number(process.env.BTC_START_HEIGHT || 869_100);

const server = ganache.server({
  logging: { quiet: true },
  chain: { chainId: 1337, hardfork: 'shanghai' },
  wallet: { deterministic: true, totalAccounts: 5 },
});
await new Promise((res, rej) => server.listen(PORT, (err) => (err ? rej(err) : res())));

const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${PORT}`, undefined, { staticNetwork: true });
const deployer = await provider.getSigner(0);
const C = compile();
const deploy = async (name, ...args) => {
  const c = await new ethers.ContractFactory(C[name].abi, C[name].bytecode, deployer).deploy(...args);
  await c.waitForDeployment();
  return c;
};

const kit = await deploy('MockBitcoinKit', START_HEIGHT);
const arena = await deploy('MadScientistArena', await kit.getAddress(), 144, 6);
const local = HEMI_NETWORKS.local;
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
console.log(`Local Hemi stand-in running on http://127.0.0.1:${PORT} (chain id 1337)
  mock hBK  ${await kit.getAddress()}
  arena     ${await arena.getAddress()}
  Bitcoin   height ${raid.tipHeight}, raid #${raid.raidId}${BLOCK_SECONDS > 0 ? `, one fake block every ${BLOCK_SECONDS}s` : ''}

Open the game with ?hemi=local, e.g. http://localhost:8000/mad-scientist-game/?hemi=local
To submit scores, import this development-only key into a test wallet profile:
  ${ethers.HDNodeWallet.fromPhrase('myth like bonus scare over problem client lizard pioneer submit female collect', undefined, "m/44'/60'/0'/0/1").privateKey}
It is ganache's public demo key. Never send real funds to it.`);
