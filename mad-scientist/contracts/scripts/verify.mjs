// Publish MadScientistArena's source on Sourcify and the Hemi explorer.
//
//   npm run verify:testnet
//   npm run verify:mainnet
//
// Verifies the `arena` address for that network in js/hemi-config.js, or
// ARENA when it is set. The constructor arguments are read from the deployed
// contract, so they always match what was deployed.
//
// Hemi's explorer (Blockscout) can refuse uploads through its API with HTTP
// 403. When it does, this writes the compiler input to upload in its web form.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import hre, { artifacts, config, network } from 'hardhat';
import { verifyContract } from '@nomicfoundation/hardhat-verify/verify';
import { HEMI_NETWORKS } from '../../js/hemi-config.js';

const CONTRACT = 'src/MadScientistArena.sol:MadScientistArena';

async function main() {
  const { ethers, networkName } = await network.create();
  const net = HEMI_NETWORKS[networkName];
  if (!net || networkName === 'local') {
    console.error('Verify with npm run verify:testnet or npm run verify:mainnet.');
    return 1;
  }
  const address = process.env.ARENA || net.arena;
  if (!ethers.isAddress(address)) {
    console.error(`No arena address for ${net.name}. Paste it into js/hemi-config.js, or set ARENA=0x...`);
    return 1;
  }
  if ((await ethers.provider.getCode(address)) === '0x') {
    console.error(`Nothing is deployed at ${address} on ${net.name}.`);
    return 1;
  }

  const arena = await ethers.getContractAt('MadScientistArena', address);
  let constructorArgs;
  try {
    constructorArgs = [await arena.bitcoinKit(), await arena.raidLength(), await arena.gracePeriod()];
  } catch (err) {
    console.error(`${address} on ${net.name} doesn't look like a MadScientistArena: ${err.shortMessage || err.message}`);
    return 1;
  }
  console.log(`Verifying MadScientistArena at ${address} on ${net.name}
  constructor(${constructorArgs.join(', ')})`);

  const failed = [];
  for (const provider of ['sourcify', 'blockscout']) {
    console.log(`\n${provider}:`);
    try {
      await verifyContract({ address, constructorArgs, contract: CONTRACT, provider }, hre);
    } catch (err) {
      console.error(err.message);
      failed.push(provider);
    }
  }

  if (failed.includes('blockscout')) {
    const { buildInfoId } = await artifacts.readArtifact(CONTRACT);
    const { input, solcLongVersion } = JSON.parse(await readFile(await artifacts.getBuildInfoPath(buildInfoId), 'utf8'));
    const dir = join(config.paths.artifacts, 'verification');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `MadScientistArena-${networkName}.json`);
    await writeFile(file, JSON.stringify(input));
    const encodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint32', 'uint32'], constructorArgs).slice(2);
    console.log(`
To verify on the ${net.name} explorer by hand, open
  ${net.explorer}/address/${address}/contract-verification
and fill in:
  Verification method   Solidity (Standard JSON input)
  Compiler              v${solcLongVersion}
  Standard JSON input   ${file}
  Contract name         MadScientistArena (if asked)
  Constructor args      ${encodedArgs} (if not fetched automatically)`);
  }
  return failed.length ? 1 : undefined;
}

process.exitCode = await main();
