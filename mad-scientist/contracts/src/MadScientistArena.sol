// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IBitcoinKit, BitcoinHeader} from "./IBitcoinKit.sol";

/// @title Mad Scientist: Lab Rampage — Bitcoin Block Raids
/// @notice Daily raids whose enemy lineup is seeded by Bitcoin, with a
/// leaderboard per raid.
///
/// Bitcoin time is split into raids of `raidLength` blocks (144 blocks, about
/// a day, by default). A raid's seed is the hash of the newest Bitcoin block
/// hVM knows when the raid is opened on-chain: by `openRaid`, or by the first
/// score submitted to it. Until then the newest block's hash stands in as a
/// provisional seed. Every player of an opened raid gets the same lineup, and
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

    struct Seed {
        bytes32 blockHash; // zero until the raid is opened
        uint32 btcHeight;
    }

    uint256 public constant BOARD_SIZE = 10;

    IBitcoinKit public immutable bitcoinKit;
    /// Bitcoin blocks per raid.
    uint32 public immutable raidLength;
    /// Bitcoin blocks after a raid ends during which its runs are still accepted.
    uint32 public immutable gracePeriod;

    mapping(uint32 raidId => Seed) private seeds;
    mapping(uint32 raidId => Entry[]) private boards;
    mapping(uint32 raidId => mapping(address player => uint32)) public bestScore;

    event RaidOpened(uint32 indexed raidId, uint32 btcHeight, bytes32 seed);
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

    /// The live raid: its id, the Bitcoin height that started it, its seed,
    /// the current Bitcoin tip known to hVM, the Bitcoin block the seed comes
    /// from, and whether the seed is locked. An unopened raid reports the tip
    /// as its provisional seed.
    function currentRaid()
        external
        view
        returns (uint32 raidId, uint32 startHeight, bytes32 seed, uint32 tipHeight, uint32 seedHeight, bool opened)
    {
        BitcoinHeader memory tip = bitcoinKit.getLastHeader();
        tipHeight = tip.height;
        raidId = tipHeight / raidLength;
        startHeight = raidId * raidLength;
        Seed memory s = seeds[raidId];
        opened = s.blockHash != 0;
        (seed, seedHeight) = opened ? (s.blockHash, s.btcHeight) : (tip.blockHash, tip.height);
    }

    /// Seed of a raid and the Bitcoin block it came from; zero if it was never opened.
    function raidSeed(uint32 raidId) external view returns (bytes32 seed, uint32 btcHeight) {
        Seed memory s = seeds[raidId];
        return (s.blockHash, s.btcHeight);
    }

    /// Lock the live raid's seed to the newest Bitcoin block, unless it is
    /// already locked. The first score submitted to a raid does this too.
    function openRaid() external returns (uint32 raidId) {
        BitcoinHeader memory tip = bitcoinKit.getLastHeader();
        raidId = tip.height / raidLength;
        _open(raidId, tip);
    }

    /// Top scores of a raid, best first.
    function getLeaderboard(uint32 raidId) external view returns (Entry[] memory) {
        return boards[raidId];
    }

    /// Record a run. Only a player's personal best per raid is kept.
    function submitScore(uint32 raidId, uint32 score, uint32 kills, uint16 wave, uint8 weapon) external {
        if (score == 0 || weapon == 0 || weapon > 10) revert InvalidRun();
        BitcoinHeader memory header = bitcoinKit.getLastHeader();
        uint32 tip = header.height;
        uint32 current = tip / raidLength;
        bool live = raidId == current;
        bool inGrace = current > 0 && raidId == current - 1 && tip - current * raidLength < gracePeriod;
        if (!live && !inGrace) revert RaidClosed(raidId, current);
        if (live) _open(raidId, header);

        uint32 best = bestScore[raidId][msg.sender];
        if (score <= best) revert NotImproved(best);
        bestScore[raidId][msg.sender] = score;

        _insert(boards[raidId], Entry(msg.sender, score, kills, wave, weapon, tip));
        emit ScoreSubmitted(raidId, msg.sender, score, kills, wave, weapon, tip);
    }

    function _open(uint32 raidId, BitcoinHeader memory tip) private {
        if (seeds[raidId].blockHash != 0) return;
        seeds[raidId] = Seed(tip.blockHash, tip.height);
        emit RaidOpened(raidId, tip.height, tip.blockHash);
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
