// Синтез звукового набора в 16-битные WAV: постель, вуш, удар, поп, аккорд.
// Никаких скачиваний — звук детерминированный и свой.
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';

const SR = 44100;

function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const seconds = (s) => Math.round(SR * s);

// Постель: две расстроенные синусоиды + медленное дыхание + тихий «ветер»
function bed(dur) {
  const n = seconds(dur);
  const out = new Float64Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const breatheSlow = 0.6 + 0.4 * Math.sin((2 * Math.PI * t) / 13);
    const pad =
      (Math.sin(2 * Math.PI * 110 * t) + Math.sin(2 * Math.PI * 110.8 * t)) * 0.5 * 0.16 +
      Math.sin(2 * Math.PI * 55 * t) * 0.1;
    // ветер: белый шум через грубый ФНЧ
    lp += (Math.random() * 2 - 1 - lp) * 0.02;
    const wind = lp * 0.35 * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / 9 + 1));
    const fadeIn = Math.min(1, t / 2);
    const fadeOut = Math.min(1, (dur - t) / 2);
    out[i] = (pad * breatheSlow + wind) * fadeIn * fadeOut * 0.7;
  }
  return out;
}

// Вуш: шумовой всплеск с огибающей-колоколом и «полосой» через ФНЧ
function whoosh(dur = 0.5) {
  const n = seconds(dur);
  const out = new Float64Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.sin(Math.PI * t) ** 2;
    lp += (Math.random() * 2 - 1 - lp) * (0.04 + 0.3 * t);
    out[i] = lp * env * 0.8;
  }
  return out;
}

// Удар: синус со скольжением высоты вниз
function thump(dur = 0.4) {
  const n = seconds(dur);
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const freq = 130 * Math.pow(0.3, t);
    phase += (2 * Math.PI * freq) / SR;
    out[i] = Math.sin(phase) * Math.pow(1 - t, 2.2) * 0.9;
  }
  return out;
}

// Поп: короткий блип вверх
function pop(dur = 0.14) {
  const n = seconds(dur);
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const freq = 480 + 500 * t;
    phase += (2 * Math.PI * freq) / SR;
    out[i] = Math.sin(phase) * Math.sin(Math.PI * t) * 0.6;
  }
  return out;
}

// Аккорд финала: до-мажорная кварта с мягким хвостом
function chime(dur = 1.1) {
  const n = seconds(dur);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 3.2);
    out[i] =
      (Math.sin(2 * Math.PI * 523.25 * t) * 0.4 +
        Math.sin(2 * Math.PI * 659.25 * t) * 0.3 +
        Math.sin(2 * Math.PI * 783.99 * t) * 0.3) *
      env *
      0.5;
  }
  return out;
}

// Тик счётчика: сухой короткий щелчок
function tick(dur = 0.05) {
  const n = seconds(dur);
  const out = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    phase += (2 * Math.PI * 1600) / SR;
    out[i] = Math.sin(phase) * Math.pow(1 - t, 3) * 0.35;
  }
  return out;
}

mkdirSync('public/sfx', { recursive: true });
writeFileSync('public/sfx/tick.wav', wav(tick()));
writeFileSync('public/sfx/bed.wav', wav(bed(30)));
writeFileSync('public/sfx/whoosh.wav', wav(whoosh()));
writeFileSync('public/sfx/thump.wav', wav(thump()));
writeFileSync('public/sfx/pop.wav', wav(pop()));
writeFileSync('public/sfx/chime.wav', wav(chime()));
console.log('SFX готовы: bed, whoosh, thump, pop, chime');
