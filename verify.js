// Pull analyze() straight out of index.html and run it on testloop.wav, whose pattern we know.
// Catches what eyeballing the app cannot: wrong tempo, half-beat grid phase, hits in the
// wrong lane. Run:  node verify.js
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const src = html.slice(html.indexOf('  function analyze(buf){'), html.indexOf('  function loadFile(f){'));
if (!src) { console.error('could not find analyze() in index.html'); process.exit(1); }
const analyze = new Function(src + '\n return analyze;')();

const w = fs.readFileSync(__dirname + '/testloop.wav');
let off = 12, sr = 44100, dO = 0, dL = 0;
while (off < w.length - 8) {
  const id = w.toString('ascii', off, off + 4), sz = w.readUInt32LE(off + 4);
  if (id === 'fmt ') sr = w.readUInt32LE(off + 12);
  if (id === 'data') { dO = off + 8; dL = sz; break; }
  off += 8 + sz + (sz & 1);
}
const N = dL / 2, ch = new Float32Array(N);
for (let i = 0; i < N; i++) ch[i] = w.readInt16LE(dO + i * 2) / 32768;

const t0 = Date.now();
const r = analyze({ sampleRate: sr, length: N, numberOfChannels: 1, getChannelData: () => ch });
const ms = Date.now() - t0;
const beat = 60 / r.bpm;
const names = ['BOOM', 'CLAP', 'tick'];
const want = ['1,5', '3,7', '16 half-count positions'];
let ok = true;

console.log(`${ms}ms   tempo ${r.bpm.toFixed(2)} (want 92)   first 1 at ${r.anchor.toFixed(3)}s (want ~0.000)`);
if (r.bpm < 91.5 || r.bpm > 92.5) { ok = false; console.log('  ✗ tempo wrong'); }
if (r.anchor > 0.05) { ok = false; console.log(`  ✗ grid phase off (half a beat = ${(beat/2).toFixed(3)}s — that means it locked onto the off-beat)`); }
console.log(`sentence: "${r.evidence}"`);
console.log('');
r.hits.forEach((list, li) => {
  const t = {};
  list.forEach(h => {
    const k = (h.t - r.anchor) / beat, nk = Math.round(k);
    const key = Math.abs(k - nk) < 0.15 ? String(((nk % 8) + 8) % 8 + 1)
      : Math.abs(k - Math.floor(k) - 0.5) < 0.15 ? (((Math.floor(k) % 8) + 8) % 8 + 1) + '½' : 'OFF';
    t[key] = (t[key] || 0) + 1;
  });
  const keys = Object.keys(t).sort((a, b) => parseFloat(a) - parseFloat(b));
  const good = li === 0 ? keys.join() === '1,5' : li === 1 ? keys.join() === '3,7' : keys.length === 16;
  if (!good) ok = false;
  console.log(`${names[li].padEnd(5)} ${String(list.length).padStart(3)} hits -> ${keys.map(k => k + '×' + t[k]).join('  ')}  ${good ? '✓' : '✗ want ' + want[li]}`);
});
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
