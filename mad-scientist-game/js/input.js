// Keyboard, mouse and virtual (touch) controls unified into named actions.

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  KeyJ: 'fire', KeyZ: 'fire', ControlLeft: 'fire',
  KeyK: 'bomb', KeyX: 'bomb', KeyB: 'bomb',
  Escape: 'pause', KeyP: 'pause',
};

export class Input {
  constructor(canvas) {
    this.held = new Set();
    this.pressedSet = new Set();
    this.virtual = new Set();
    this.stick = 0;
    this.onAnyInput = null;

    addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressedSet.add(a);
      this.held.add(a);
      this.onAnyInput?.();
    });
    addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.held.delete(a);
    });
    addEventListener('blur', () => { this.held.clear(); this.virtual.clear(); this.stick = 0; });

    canvas.addEventListener('mousedown', (e) => {
      const a = e.button === 2 ? 'bomb' : e.button === 0 ? 'fire' : null;
      if (!a) return;
      this.held.add(a);
      this.pressedSet.add(a);
      this.onAnyInput?.();
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.held.delete('fire');
      if (e.button === 2) this.held.delete('bomb');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(a) { return this.held.has(a) || this.virtual.has(a); }
  pressed(a) { return this.pressedSet.has(a); }

  get axis() {
    const k = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    return k !== 0 ? k : this.stick;
  }

  press(a) { this.virtual.add(a); this.pressedSet.add(a); this.onAnyInput?.(); }
  release(a) { this.virtual.delete(a); }

  endFrame() { this.pressedSet.clear(); }
  reset() { this.held.clear(); this.virtual.clear(); this.pressedSet.clear(); this.stick = 0; }
}
