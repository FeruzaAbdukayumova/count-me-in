#!/usr/bin/env python3
"""Generate testloop.wav: a 92 BPM drum loop with a pattern we know in advance.
BOOM (kick) on counts 1 and 5, CLAP (snare) on 3 and 7, tick (hat) on every half count.
Sounds are spectrally realistic — a white-noise 'hat' has low-frequency content that real
hi-hats don't, which makes the app look broken when it isn't."""
import struct, math, random
SR=44100; BPM=92.0; beat=60.0/BPM; EIGHTS=4
total=beat*8*EIGHTS; n=int(SR*total); buf=[0.0]*n
random.seed(11)

def lp(sig, fc, times=1):
    a=1-math.exp(-2*math.pi*fc/SR)
    for _ in range(times):
        y=0.0; out=[]
        for x in sig: y+=a*(x-y); out.append(y)
        sig=out
    return sig
def hp(sig, fc, times=1): return [x-l for x,l in zip(sig, lp(sig,fc,times))]
def noise(d): return [random.uniform(-1,1) for _ in range(int(SR*d))]
def decay(sig, rate): return [v*math.exp(-i/SR*rate) for i,v in enumerate(sig)]

kick=[0.95*math.exp(-(i/SR)*9)*math.sin(2*math.pi*(115*math.exp(-(i/SR)*22)+45)*(i/SR))
      for i in range(int(SR*0.30))]
snare=[b+0.9*z for b,z in zip(
    [0.38*math.exp(-i/SR*26)*math.sin(2*math.pi*190*(i/SR)) for i in range(int(SR*0.18))],
    decay(lp(hp(noise(0.18),900,2),5000,2),30))]
hat=[0.5*v for v in decay(hp(noise(0.05),6000,4),150)]

def place(t0,sig):
    s=int(t0*SR)
    for i,v in enumerate(sig):
        if s+i<n: buf[s+i]+=v
for e in range(EIGHTS):
    base=e*beat*8
    for c in (0,4): place(base+c*beat,kick)
    for c in (2,6): place(base+c*beat,snare)
    for c in range(8): place(base+c*beat,hat); place(base+(c+0.5)*beat,hat)

peak=max(abs(v) for v in buf) or 1.0
pcm=b''.join(struct.pack('<h',int(max(-1,min(1,v/peak*0.89))*32767)) for v in buf)
open('testloop.wav','wb').write(
  b'RIFF'+struct.pack('<I',36+len(pcm))+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,1,SR,SR*2,2,16)
  +b'data'+struct.pack('<I',len(pcm))+pcm)
print('testloop.wav written — %.1fs, %g BPM, BOOM 1&5, CLAP 3&7, tick every half' % (total,BPM))
