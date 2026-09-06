(function (root) {
  'use strict';
  // W3C standard mapping: axes[0] left stick X, buttons[7] RT, buttons[6] LT,
  // buttons[0] A, [1] B, [2] X, [3] Y, [4] LB, [9] Start.
  const STEER_DEADZONE = 0.12, THROTTLE_DEADZONE = 0.05, BRAKE_THRESHOLD = 0.3;
  const EDGE_ACTIONS = { 1: 'nitro', 2: 'item', 3: 'reset', 9: 'pause' };
  let padIndex = null, enabled = false, prevButtons = [];
  const connectCallbacks = [], disconnectCallbacks = [];
  function pads() {
    try { return typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []; } catch { return []; }
  }
  function findPad() {
    for (const pad of pads()) {
      if (pad && pad.connected && pad.mapping === 'standard') return pad.index;
    }
    return null;
  }
  // Chrome only fires gamepadconnected after a button press; a lazy scan catches
  // pads plugged in before page load (and keeps the e2e mock simple).
  function ensurePad() {
    if (padIndex !== null) return;
    const found = findPad();
    if (found !== null) { padIndex = found; resetEdges(); }
  }
  function rescale(value, deadzone) {
    const v = Math.abs(value);
    return v < deadzone ? 0 : Math.sign(value) * Math.min(1, (v - deadzone) / (1 - deadzone));
  }
  // Call after state transitions (start/resume/menu) so a button held across
  // the transition does not fire again on the first frame back.
  function resetEdges() { const pad = padIndex !== null ? pads()[padIndex] : null; prevButtons = pad ? pad.buttons.map(b => Boolean(b.pressed)) : []; }
  const KartGamepad = {
    setEnabled(value) { enabled = Boolean(value); if (enabled) ensurePad(); },
    connected() { ensurePad(); return padIndex !== null; },
    label() {
      ensurePad();
      if (padIndex === null) return '';
      const pad = pads()[padIndex];
      return pad && pad.id ? pad.id.replace(/\s*\(.*?\)\s*/g, ' ').trim() : '';
    },
    onConnect(cb) { connectCallbacks.push(cb); },
    onDisconnect(cb) { disconnectCallbacks.push(cb); },
    resetEdges,
    poll() {
      if (!enabled) return null;
      ensurePad();
      if (padIndex === null) return null;
      const pad = pads()[padIndex];
      if (!pad || !pad.connected) return null;
      const steerAxis = rescale(pad.axes[0] || 0, STEER_DEADZONE);
      const throttle = rescale(pad.buttons[7] ? pad.buttons[7].value : 0, THROTTLE_DEADZONE);
      const pressed = new Set();
      pad.buttons.forEach((button, i) => {
        if (button.pressed && !prevButtons[i] && EDGE_ACTIONS[i]) pressed.add(EDGE_ACTIONS[i]);
      });
      prevButtons = pad.buttons.map(b => Boolean(b.pressed));
      return {
        // Keyboard steer is left-positive (left - right); stick left is negative.
        steer: -steerAxis,
        throttle,
        brake: Boolean(pad.buttons[6] && (pad.buttons[6].pressed || pad.buttons[6].value > BRAKE_THRESHOLD)),
        drift: Boolean((pad.buttons[0] && pad.buttons[0].pressed) || (pad.buttons[4] && pad.buttons[4].pressed)),
        pressed
      };
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('gamepadconnected', event => {
      if (!event.gamepad || event.gamepad.mapping !== 'standard') return;
      if (padIndex === null) { padIndex = event.gamepad.index; resetEdges(); }
      connectCallbacks.forEach(cb => cb(KartGamepad.label()));
    });
    window.addEventListener('gamepaddisconnected', event => {
      if (padIndex === null || event.gamepad.index !== padIndex) return;
      padIndex = null; prevButtons = [];
      disconnectCallbacks.forEach(cb => cb());
    });
  }
  root.KartGamepad = KartGamepad;
})(globalThis);
