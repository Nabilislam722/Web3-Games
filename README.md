# Web3 Games

| Game | Folder | Description |
| --- | --- | --- |
| Mad Scientist: Lab Rampage | [`mad-scientist/`](mad-scientist/) | Side-scrolling run-and-gun with skeletal Spine animation and 10 unlockable guns. Daily Bitcoin Block Raids are seeded by Bitcoin block hashes read through Hemi's hVM, with an on-chain leaderboard on Hemi. |

Play it at https://blockchainrampage.ni13989.workers.dev. The game's art lives
in [`mad-scientist/assets/`](mad-scientist/assets/).

## Play locally

```bash
cd mad-scientist
python -m http.server 8000
# then open http://localhost:8000/
```

See [`mad-scientist/README.md`](mad-scientist/README.md) for controls, the Hemi
setup and deployment.
