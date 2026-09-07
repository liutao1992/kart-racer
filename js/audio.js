(function (root) {
  'use strict';
  class KartAudio {
    constructor(enabled = true) { this.enabled = enabled; this.context = null; this.available = true; this.voices = new Set(); this.destroyed = false; this.previousStatus = {}; }
    async unlock() {
      if (!this.enabled || !this.available || this.destroyed) return;
      try {
        if (!this.context) {
          const AudioContext = root.AudioContext || root.webkitAudioContext;
          if (!AudioContext) { this.available = false; return; }
          this.context = new AudioContext();
          const ctx = this.context;
          this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
          this.statusTone = ctx.createOscillator(); this.statusTone.type = 'sine';
          this.statusGain = ctx.createGain(); this.statusGain.gain.value = 0;
          this.statusTone.connect(this.statusGain); this.statusGain.connect(this.master); this.statusTone.start();
          this.engine = ctx.createOscillator(); this.engine.type = 'sawtooth'; this.engine.frequency.value = 55;
          this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
          const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 350; filter.Q.value = 0.5;
          this.engine.connect(filter); filter.connect(this.engineGain); this.engineGain.connect(this.master); this.engine.start();
          const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), values = buffer.getChannelData(0);
          for (let i = 0; i < values.length; i++) values[i] = Math.random() * 2 - 1;
          this.noise = ctx.createBufferSource(); this.noise.buffer = buffer; this.noise.loop = true;
          this.noiseFilter = ctx.createBiquadFilter(); this.noiseFilter.type = 'bandpass'; this.noiseFilter.frequency.value = 1600; this.noiseFilter.Q.value = 0.65;
          this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
          this.noise.connect(this.noiseFilter); this.noiseFilter.connect(this.noiseGain); this.noiseGain.connect(this.master); this.noise.start();
        }
        if (this.context.state === 'suspended') await this.context.resume();
      } catch { this.available = false; }
    }
    setEnabled(enabled) { this.enabled = enabled; if (enabled) void this.unlock(); else this.silence(); }
    silence() {
      this.previousStatus = {};
      if (this.context && this.statusGain) { this.statusGain.gain.cancelScheduledValues(this.context.currentTime); this.statusGain.gain.setValueAtTime(0, this.context.currentTime); }
      if (this.context && this.master) { this.master.gain.cancelScheduledValues(this.context.currentTime); this.master.gain.setValueAtTime(0, this.context.currentTime); }
      for (const voice of this.voices) { try { voice.stop(); } catch {} }
      this.voices.clear();
    }
    destroy() {
      this.destroyed = true; this.enabled = false; this.silence();
      for (const source of [this.engine, this.noise, this.statusTone]) { try { source?.stop(); source?.disconnect(); } catch {} }
      if (this.context) { void this.context.close().catch(() => {}); this.context = null; }
    }
    update(car, active) {
      if (!this.context || !this.master || this.context.state !== 'running') return;
      const now = this.context.currentTime, on = active && this.enabled;
      if (!on) { this.silence(); return; }
      for (const field of ['bubble', 'zap', 'ufo', 'magnet']) {
        if (this.previousStatus[field] > 0 && !(car[field] > 0)) this.event('release', field);
        this.previousStatus[field] = car[field] || 0;
      }
      const status = this.raceFinished ? '' : car.zap > 0 ? 'zap' : car.bubble > 0 ? 'bubble' : car.ufo > 0 ? 'ufo' : car.magnet > 0 ? 'magnet' : '';
      if (this.statusTone) {
        const pitch = { zap: 105, bubble: 330, ufo: 185, magnet: 245 }[status] || 180;
        this.statusTone.frequency.setTargetAtTime(pitch + (status === 'ufo' ? Math.sin(now * 5) * 22 : status === 'bubble' ? Math.sin(now * 3) * 12 : 0), now, 0.07);
        this.statusGain.gain.setTargetAtTime(status ? 0.055 : 0, now, 0.04);
      }
      this.master.gain.setTargetAtTime(on ? 0.2 : 0, now, 0.08);
      this.engine.frequency.setTargetAtTime(48 + Math.abs(car.speed) * 2.5 + (car.boost > 0 ? 20 : 0), now, 0.09);
      this.engineGain.gain.setTargetAtTime(on ? 0.12 + Math.abs(car.speed) / 800 : 0, now, 0.09);
      this.noiseGain.gain.setTargetAtTime(on ? (car.drift ? 0.24 : car.boost > 0 ? 0.2 : Math.abs(car.speed) * 0.001) : 0, now, 0.06);
      this.noiseFilter.frequency.setTargetAtTime(car.drift ? 1500 + car.charge * 6 : car.boost > 0 ? 650 : 400, now, 0.1);
    }
    tone(frequency = 660, duration = 0.16, delay = 0, type = 'sine') {
      if (this.destroyed || !this.enabled || !this.context || !this.master || this.context.state !== 'running' || this.voices.size >= 32) return;
      const ctx = this.context, start = ctx.currentTime + delay, oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.type = type; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.23, start + 0.009); gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      oscillator.connect(gain); gain.connect(this.master); oscillator.start(start); oscillator.stop(start + duration + 0.02);
      this.voices.add(oscillator);
      oscillator.onended = () => { this.voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    }
    event(type, item) {
      if (type === 'finish') this.raceFinished = true;
      if (type === 'count' || type === 'go') this.raceFinished = false;
      if (type === 'reset') { this.silence(); return; }
      if (type === 'count') this.tone(520, 0.13);
      if (type === 'go') this.tone(1040, 0.4);
      if (type === 'miniBoost') { this.tone(660, 0.09); this.tone(990, 0.16, 0.06); }
      if (type === 'charged') { this.tone(780, 0.13); this.tone(1170, 0.25, 0.1); }
      if (type === 'lap') { this.tone(660, 0.16); this.tone(880, 0.2, 0.12); }
      if (type === 'bump') this.tone(75, 0.1, 0, 'triangle');
      if (type === 'itemPickup') { this.tone(880, 0.09); this.tone(1320, 0.14, 0.07); }
      if (type === 'item-missile' || type === 'missileLaunch') { this.tone(300, 0.2, 0, 'sawtooth'); this.tone(600, 0.25, 0.1, 'sawtooth'); }
      if (type === 'item-banana') { this.tone(500, 0.1); this.tone(350, 0.12, 0.08); }
      if (type === 'item-water') { this.tone(700, 0.15); this.tone(450, 0.3, 0.1); }
      if (type === 'item-magnet') { this.tone(220, 0.3, 0, 'square'); this.tone(440, 0.2, 0.15); }
      if (type === 'item-shield' || type === 'itemBlock') { this.tone(980, 0.12); this.tone(1470, 0.2, 0.08); }
      if (type === 'item-nitro') { this.tone(780, 0.13); this.tone(1170, 0.25, 0.1); }
      if (type === 'item-lightning') { this.tone(1400, 0.07, 0, 'square'); this.tone(180, 0.35, 0.05, 'sawtooth'); }
      if (type === 'item-ufo') { this.tone(320, 0.35); this.tone(480, 0.3, 0.18); }
      if (type === 'itemHit') {
        if (item === 'lightning') { this.tone(1450, 0.045, 0, 'sawtooth'); this.tone(110, 0.23, 0.025, 'square'); this.tone(270, 0.09, 0.14, 'sawtooth'); }
        else if (item === 'water') { this.tone(880, 0.07); this.tone(420, 0.14, 0.04); this.tone(240, 0.2, 0.12); }
        else if (item === 'ufo') { this.tone(620, 0.13); this.tone(390, 0.16, 0.08); this.tone(190, 0.26, 0.18); }
        else if (item === 'banana') { this.tone(760, 0.07, 0, 'triangle'); this.tone(560, 0.1, 0.06, 'triangle'); this.tone(290, 0.14, 0.14, 'triangle'); }
        else { this.tone(180, 0.25, 0, 'triangle'); this.tone(90, 0.3, 0.08, 'triangle'); }
      }
      if (type === 'release') {
        if (item === 'bubble') { this.tone(1100, 0.045); this.tone(580, 0.07, 0.035); }
        else if (item === 'ufo') { this.tone(460, 0.12); this.tone(920, 0.14, 0.08); }
        else this.tone(620, 0.06, 0, 'triangle');
      }
      if (type === 'finish') [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.36, i * 0.12));
    }
  }
  root.KartAudio = KartAudio;
})(globalThis);
