// Generates a mono 16-bit PCM WAV with N short noise bursts ("strums")
// at a fixed interval, for feeding into Chromium's
// --use-file-for-fake-audio-capture to test onset-driven behavior.
import fs from 'node:fs';

const [, , countStr, intervalStr, outPath] = process.argv;
const count = parseInt(countStr, 10);
const intervalSec = parseFloat(intervalStr);
const sampleRate = 44100;
const burstDurationSec = 0.08;
const totalDurationSec = count * intervalSec + 1;
const numSamples = Math.floor(sampleRate * totalDurationSec);

const dataSize = numSamples * 2;
const buf = Buffer.alloc(44 + dataSize);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + dataSize, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(sampleRate, 24);
buf.writeUInt32LE(sampleRate * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(dataSize, 40);

const burstSamples = Math.floor(sampleRate * burstDurationSec);
for (let b = 0; b < count; b++) {
  const startSample = Math.floor(b * intervalSec * sampleRate);
  for (let i = 0; i < burstSamples; i++) {
    const idx = startSample + i;
    if (idx >= numSamples) break;
    // A decaying noise burst -- percussive-ish, like a strum's attack.
    const envelope = 1 - i / burstSamples;
    const sample = Math.round((Math.random() - 0.5) * 2 * 0.7 * envelope * 32767);
    buf.writeInt16LE(sample, 44 + idx * 2);
  }
}

fs.writeFileSync(outPath, buf);
console.log(`Wrote ${outPath}: ${count} bursts, ${intervalSec}s apart`);
