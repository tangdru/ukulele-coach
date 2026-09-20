// Generates a mono 16-bit PCM WAV file containing a pure sine tone, for
// feeding into Chromium's --use-file-for-fake-audio-capture in tests.
import fs from 'node:fs';

const [, , freqStr, outPath, durationStr] = process.argv;
const freq = parseFloat(freqStr);
const durationSec = parseFloat(durationStr || '5');
const sampleRate = 44100;
const numSamples = Math.floor(sampleRate * durationSec);
const amplitude = 0.5 * 32767;

const dataSize = numSamples * 2;
const buf = Buffer.alloc(44 + dataSize);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + dataSize, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(1, 22); // mono
buf.writeUInt32LE(sampleRate, 24);
buf.writeUInt32LE(sampleRate * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(dataSize, 40);

for (let i = 0; i < numSamples; i++) {
  const sample = Math.round(amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate));
  buf.writeInt16LE(sample, 44 + i * 2);
}

fs.writeFileSync(outPath, buf);
console.log(`Wrote ${outPath}: ${freq}Hz, ${durationSec}s`);
