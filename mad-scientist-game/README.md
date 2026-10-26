# Mad Scientist: Lab Rampage

A side-scrolling run-and-gun built on the **Mad scientist** asset pack in this
repo. You play the mad scientist and fight your way through hazmat guards and
drones in two lab zones, collecting potions to unlock 10 experimental guns.

All characters, enemies, items and effects play their original **Spine 3.8**
skeletal animations through a small runtime written for this game. Poses are
interpolated every frame and blended into each other, so the animation stays
smooth at any refresh rate. There are no dependencies and no build step.

## Run it

The game uses ES modules and `fetch`, so it must be served over HTTP (opening
`index.html` from disk won't work). From the **repository root**:

```bash
python3 -m http.server 8000
# open http://localhost:8000/mad-scientist-game/
```

Any static host works the same way, including GitHub Pages serving the repo root.
The game loads its art straight from `../Mad scientist/`, so keep both folders
side by side.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | `A` `D` / `←` `→` | Left stick |
| Jump | `Space` / `W` / `↑` | Arrow button |
| Fire (hold) | `J` / `Z` / left click | Crosshair button |
| Throw bomb | `K` / `X` / right click | Bomb button |
| Pause | `Esc` / `P` | Pause button |
| Mute | `M` | Speaker button |

## Gameplay

- **Sectors and waves.** Each sector has 5 waves and the 5th brings elite
  guards. The camera locks during a fight; when the wave is clear, follow the
  **GO →** arrow to the next one. Sectors alternate between the *Cryo Labs* and
  the *Bio Vault*, and each new sector is harder.
- **Enemies.** Melee guards rush you with batons (jump over the swing). Gunners
  hold their range and fire after a red muzzle glint (jump the bullets). Drones
  drop dynamite or shoot fireballs and swoop low from time to time. Your gun
  arm auto-aims at drones above you.
- **Status effects.** Some guns freeze guards (frozen guards take +50% damage
  and shatter), shock them, or apply acid/burn damage over time.
- **Pickups.** Every guard drops potion vials, which are your currency. Rare
  flasks give a heal (green), double damage for 8 s (red) or +2 bombs (purple).
- **Combos.** Chain kills to raise the score multiplier, up to ×4. Taking a hit
  resets it.

### Armory

Spend potions in the **Armory** to unlock and equip guns. The scientist
test-fires the selected gun live in the background.

| Gun | Cost | Special |
| --- | ---: | --- |
| Plasma Claw | 0 | Balanced |
| Goo Slinger | 60 | Acid damage over time |
| Inferno Horn | 140 | Piercing fireballs, burns |
| Tesla Ray | 220 | Chain lightning, stuns |
| Rail Rifle | 300 | Infinite pierce |
| Cryo Cannon | 380 | Freezes |
| Buzz Blaster | 470 | Very fast fire rate |
| Boom Tube | 580 | Explosive splash |
| Haymaker | 700 | Boxing glove, huge knockback |
| Shark Spitter | 850 | Shotgun spread |

Progress (potions, unlocks, equipped gun, best score, mute) is saved in
`localStorage`.

## How the animation stays smooth

- **Skeletal playback.** `js/spine.js` reads the pack's `skeleton.json` and
  `.atlas` exports (bones, slots, region attachments, rotate, translate, scale
  and shear timelines, colour and attachment keys). It was checked frame by
  frame against the pack's PNG exports.
- **Blending.** Every animation change cross-fades. Shooting, bomb throws and
  hit reactions play on a second track that only drives the upper body, so the
  legs keep walking. The walk cycle speeds up, slows down and reverses with
  movement speed.
- **Procedural layers.** The gun arm bone rotates toward targets, turning
  around is a quick "paper flip", jumps and landings use squash and stretch, and
  drones tilt into their movement.
- **Game feel.** Spring-damped camera, parallax silhouettes, hit-stop, trauma
  screen shake, slow motion on the last kill of a wave, hit flashes, pooled
  particles, and damage numbers in the game font.
- **Rendering.** `js/gl.js` is a WebGL quad batcher with per-sprite tint, flash
  and additive blending. A full scene takes about 20–30 draw calls.
- **UI.** Menus, the HUD and modals are HTML with CSS spring transitions over
  the canvas.

Sound effects and the music loop are synthesised with WebAudio (`js/audio.js`),
so the game has no audio files.

## Project layout

```
mad-scientist-game/
├── index.html      screens, HUD and modals markup
├── style.css       UI styling and transitions
├── viewer.html     dev tool: browse and play every skeleton and animation
└── js/
    ├── main.js     boot, asset loading, resize, frame loop
    ├── game.js     camera, parallax, wave director, combat, pickups, rendering
    ├── actors.js   Hero and Enemy (AI, animation state, hit boxes)
    ├── fx.js       particles, damage numbers, one-shot Spine effects
    ├── spine.js    Spine 3.8 runtime (atlas, skeleton, animation state)
    ├── gl.js       WebGL sprite batcher
    ├── data.js     weapon, enemy, wave and zone tuning
    ├── ui.js       DOM screens, armory, HUD, touch controls
    ├── audio.js    synthesised SFX and music
    ├── input.js    keyboard, mouse and virtual controls
    ├── assets.js   asset manifest (paths into "Mad scientist/")
    └── util.js     math, springs, collision, profile storage
```

To tune difficulty, weapons or enemies, edit `js/data.js`. To inspect an
animation, open `viewer.html` (served the same way as the game).

## Credits

Art comes from the *Mad scientist* asset pack in this repository. Fonts are
[Luckiest Guy](https://fonts.google.com/specimen/Luckiest+Guy) and
[Passion One](https://fonts.google.com/specimen/Passion+One) from Google Fonts
(listed in `Mad scientist/FontLink.txt`).
