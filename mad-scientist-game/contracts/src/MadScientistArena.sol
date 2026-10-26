// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IBitcoinKit, BitcoinHeader} from "./IBitcoinKit.sol";

/// @title Mad Scientist: Lab Rampage — Bitcoin Block Raids
/// @notice Daily raids whose enemy lineup is seeded by Bitcoin, with a
/// leaderboard per raid.
///
/// Bitcoin time is split into raids of `raidLength` blocks (144 blocks, about
/// a day, by default). A raid's seed is the hash of the Bitcoin block that
/// opens it, read through Hemi's hVM. Every player gets the same lineup, and
/// nobody can know it before miners produce that block.
///
/// Scores are reported by the game client and are not verified on-chain.
contract MadScientistArena {
    struct Entry {
        address player;
        uint32 score;
        uint32 kills;
        uint16 wave; // global wave reached (sector * 5 + wave)
        uint8 weapon; // 1..10, the gun used for the run
        uint32 btcHeight; // Bitcoin tip seen by hVM when the score was recorded
    }

    uint256 public constant BOARD_SIZE = 10;

    IBitcoinKit public immutable bitcoinKit;
    /// Bitcoin blocks per raid.
    uint32 public immutable raidLength;
    /// Bitcoin blocks after a raid ends during which its runs are still accepted.
    uint32 public immutable gracePeriod;

    mapping(uint32 raidId => Entry[]) private boards;
    mapping(uint32 raidId => mapping(address player => uint32)) public bestScore;

    event ScoreSubmitted(
        uint32 indexed raidId, address indexed player, uint32 score, uint32 kills, uint16 wave, uint8 weapon, uint32 btcHeight
    );

    error RaidClosed(uint32 raidId, uint32 currentRaidId);
    error NotImproved(uint32 best);
    error InvalidRun();

    constructor(IBitcoinKit kit, uint32 raidLength_, uint32 gracePeriod_) {
        require(address(kit) != address(0) && raidLength_ > 0 && gracePeriod_ < raidLength_, "bad config");
        bitcoinKit = kit;
        raidLength = raidLength_;
        gracePeriod = gracePeriod_;
    }

    /// The live raid: its id, the Bitcoin height that opened it, its seed
    /// (that block's hash) and the current Bitcoin tip known to hVM.
    function currentRaid() external view returns (uint32 raidId, uint32 startHeight, bytes32 seed, uint32 tipHeight) {
        BitcoinHeader memory tip = bitcoinKit.getLastHeader();
        tipHeight = tip.height;
        raidId = tipHeight / raidLength;
        startHeight = raidId * raidLength;
        seed = startHeight == tipHeight ? tip.blockHash : bitcoinKit.getHeaderN(startHeight).blockHash;
    }

    /// Seed of any raid that has already opened.
    function raidSeed(uint32 raidId) external view returns (bytes32) {
        return bitcoinKit.getHeaderN(raidId * raidLength).blockHash;
    }

    /// Top scores of a raid, best first.
    function getLeaderboard(uint32 raidId) external view returns (Entry[] memory) {
        return boards[raidId];
    }

    /// Record a run. Only a player's personal best per raid is kept.
    function submitScore(uint32 raidId, uint32 score, uint32 kills, uint16 wave, uint8 weapon) external {
        if (score == 0 || weapon == 0 || weapon > 10) revert InvalidRun();
        uint32 tip = bitcoinKit.getLastHeader().height;
        uint32 current = tip / raidLength;
        bool live = raidId == current;
        bool inGrace = current > 0 && raidId == current - 1 && tip - current * raidLength < gracePeriod;
        if (!live && !inGrace) revert RaidClosed(raidId, current);

        uint32 best = bestScore[raidId][msg.sender];
        if (score <= best) revert NotImproved(best);
        bestScore[raidId][msg.sender] = score;

        _insert(boards[raidId], Entry(msg.sender, score, kills, wave, weapon, tip));
        emit ScoreSubmitted(raidId, msg.sender, score, kills, wave, weapon, tip);
    }

    /// Keep `b` sorted by score (ties keep the earlier entry first), one entry
    /// per player, at most BOARD_SIZE long.
    function _insert(Entry[] storage b, Entry memory e) private {
        uint256 n = b.length;
        for (uint256 i = 0; i < n; i++) {
            if (b[i].player == e.player) {
                for (uint256 j = i; j + 1 < n; j++) b[j] = b[j + 1];
                b.pop();
                n--;
                break;
            }
        }
        uint256 pos = n;
        while (pos > 0 && b[pos - 1].score < e.score) pos--;
        if (pos >= BOARD_SIZE) return;
        if (n < BOARD_SIZE) b.push(e);
        for (uint256 j = b.length - 1; j > pos; j--) b[j] = b[j - 1];
        b[pos] = e;
    }
}
