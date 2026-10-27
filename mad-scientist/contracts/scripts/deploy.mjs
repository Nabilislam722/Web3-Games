// Deploy MadScientistArena to Hemi.
//
//   npm run deploy:testnet
//   npm run deploy:mainnet
//
// PRIVATE_KEY is read from contracts/.env or the environment.
// Optional: RPC_URL (another provider), RAID_LENGTH (Bitcoin blocks per raid,
// default 144), GRACE_BLOCKS (late submissions allowed, default 6).
import { network } from 'hardhat';
import { HEMI_NETWORKS } from '../../js/hemi-config.js';

async function main() {
  const { ethers, networkName } = await network.create();
  const net = HEMI_NETWORKS[networkName];
  if (!net || networkName === 'local') {
    console.error('Deploy with npm run deploy:testnet or npm run deploy:mainnet.');
    return 1;
  }
  const raidLength = BigInt(process.env.RAID_LENGTH || 144);
  const grace = BigInt(process.env.GRACE_BLOCKS || 6);

  // Check that hBK answers the one call the arena makes before spending gas.
  const kit = await ethers.getContractAt('IBitcoinKit', net.bitcoinKit);
  let tip;
  try {
    tip = await kit.getLastHeader();
  } catch (err) {
    console.error(`hBK at ${net.bitcoinKit} on ${net.name} doesn't answer getLastHeader(): ${err.reason || err.shortMessage || err.message}
Check bitcoinKit for this network in js/hemi-config.js. Nothing was sent.`);
    return 1;
  }
  console.log(`${net.name}: hVM sees Bitcoin block ${tip.height} (${tip.blockHash})`);

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer ${deployer.address} has ${ethers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    console.error(`No ETH for gas. Bridge some to ${net.name} first (https://app.hemi.xyz/en/tunnel/).`);
    return 1;
  }

  const arena = await ethers.deployContract('MadScientistArena', [net.bitcoinKit, raidLength, grace]);
  console.log(`Deploying… tx ${arena.deploymentTransaction().hash}`);
  await arena.waitForDeployment();
  const address = await arena.getAddress();
  const raid = await arena.currentRaid();

  console.log(`
MadScientistArena deployed at ${address}
${net.explorer}/address/${address}
Live raid #${raid.raidId} started at Bitcoin block ${raid.startHeight}. Its seed locks in with its first score.

Paste the address into js/hemi-config.js:
  ${networkName}: { ..., arena: '${address}' }
Then publish its source on the explorer:
  npm run verify:${networkName}`);
}

process.exitCode = await main();
