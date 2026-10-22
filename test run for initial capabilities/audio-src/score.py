#!/usr/bin/env python3
"""FIRST LIGHT - complete soundtrack generator (numpy only).

Renders public/audio/first-light.wav (48 kHz / 16-bit / stereo / exactly 28.000 s)
and out/audio-check.png (waveform + loudness + spectrogram + cue strip), then
prints a verification report. Every cue frame f lands on sample f * 1600.
Run:  python3 -I audio-src/score.py
"""
import json
import os
import struct
import sys
import time
import zlib

import numpy as np

T0 = time.time()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_WAV = os.path.join(ROOT, "public", "audio", "first-light.wav")
OUT_PNG = os.path.join(ROOT, "out", "audio-check.png")
SPEC = os.path.join(ROOT, "src", "film", "SPEC.json")

SR = 48000
FPS = 30
SPF = SR // FPS            # 1600 samples per frame
NFR = 840
N = NFR * SPF              # 1,344,000 samples
CUT_A = 580 * SPF          # hard dropout
IGN = 600 * SPF            # ignition
TWO_PI = 2.0 * np.pi


def F(f):
    """frame -> sample index (sample-accurate cue placement)."""
    return int(round(f * SPF))


def secs(x):
    return int(round(x * SR))


def dbg(x):
    return 10.0 ** (x / 20.0)


def rng(seed):
    return np.random.default_rng(seed)


def noise(n, seed):
    return rng(seed).standard_normal(n)


# ----------------------------------------------------------------- curves --
def ease_io(x):
    x = np.clip(x, 0.0, 1.0)
    return 0.5 - 0.5 * np.cos(np.pi * x)


def ease_in(x, p=2.0):
    return np.clip(x, 0.0, 1.0) ** p


def ease_out(x, p=2.0):
    return 1.0 - (1.0 - np.clip(x, 0.0, 1.0)) ** p


def expmap(a, b, x):
    """exponential interpolation a->b for x in [0,1]."""
    return a * (b / a) ** np.clip(x, 0.0, 1.0)


def edge_fade(sig, fin=0.002, fout=0.004):
    sig = np.array(sig, dtype=float, copy=True)
    n = sig.shape[-1]
    a = min(n, max(2, secs(fin)))
    b = min(n, max(2, secs(fout)))
    e = np.ones(n)
    e[:a] *= ease_io(np.arange(a) / (a - 1))
    e[n - b:] *= ease_io(np.arange(b)[::-1] / (b - 1))
    return sig * e


def perc(n, att, tau, hold=0.0):
    t = np.arange(n) / SR
    e = np.where(t < att, ease_io(t / max(att, 1e-6)),
                 np.exp(-np.clip(t - att - hold, 0, None) / tau))
    return edge_fade(e, fin=0.0, fout=min(0.01, n / SR * 0.2))


# ------------------------------------------------------------ oscillators --
def phase_of(freq):
    ph = TWO_PI * np.cumsum(freq) / SR
    return ph - ph[0]


def sine(freq, n=None, phase0=0.0):
    if np.isscalar(freq):
        freq = np.full(n, float(freq))
    return np.sin(phase_of(freq) + phase0)


def saw_voice(freq, cutoff, order=3, lim=3.0):
    """Band-limited additive saw with a per-harmonic low-pass (cutoff may move).
    sin(k x) via the Chebyshev recurrence: s_{k+1} = 2cos(x) s_k - s_{k-1}."""
    n = len(freq)
    ph = phase_of(freq) + 0.3
    c2 = 2.0 * np.cos(ph)
    sk = np.sin(ph)
    sp = np.sin(ph - ph)  # sin(0 * x) = 0
    inv_c = 1.0 / np.asarray(cutoff, dtype=float)
    K = max(1, int(np.max(np.minimum(0.45 * SR, lim / inv_c) / freq)))
    fmax = float(np.max(freq))
    out = np.zeros(n)
    for k in range(1, K + 1):
        fk = k * freq
        x = fk * inv_c
        x2 = x * x
        xo = x2 * x2 * x2 if order == 3 else x2 * x2
        a = (1.0 / k) / np.sqrt(1.0 + xo)
        if k * fmax > 0.40 * SR:
            a = a * np.clip((0.47 * SR - fk) / (0.07 * SR), 0.0, 1.0)
        out += a * sk
        sk, sp = c2 * sk - sp, sk
    return out * (2.0 / np.pi)


def pan(m, p):
    """equal-power pan, unity at centre."""
    th = (np.clip(p, -1, 1) + 1.0) * np.pi / 4.0
    return np.vstack([m * np.cos(th), m * np.sin(th)]) * np.sqrt(2.0)


def haas(st, ms, delay_ch=1):
    d = secs(ms / 1000.0)
    out = np.array(st, copy=True)
    if d > 0:
        out[delay_ch, d:] = st[delay_ch, :-d]
        out[delay_ch, :d] = 0.0
    return out


def width(st, w):
    m = 0.5 * (st[0] + st[1])
    s = 0.5 * (st[0] - st[1]) * w
    return np.vstack([m + s, m - s])


def soft(x, drive=1.0):
    """waveshaper for constant-amplitude oscillators (peak 1 -> 1)."""
    return np.tanh(drive * x) / np.tanh(drive)


def knee(x, t=0.7):
    """unity-gain soft clipper: linear below t, tanh knee above."""
    a = np.abs(x)
    return np.sign(x) * np.where(a < t, a, t + (1 - t) * np.tanh((a - t) / (1 - t)))


# ---------------------------------------------------------------- filters --
def m_lp(f, fc, order=2):
    return 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * order))


def m_hp(f, fc, order=2):
    return 1.0 / np.sqrt(1.0 + (fc / np.maximum(f, 1e-3)) ** (2 * order))


def m_bp(f, fc, octaves):
    return np.exp(-0.5 * (np.log2(np.maximum(f, 1.0) / fc) / octaves) ** 2)


def stft_shape(x, maskfn, nfft=2048, hop=512):
    """Time-varying spectral filter. maskfn(freqs[1,B], t_sec[F,1]) -> gain[F,B]."""
    n = len(x)
    win = np.hanning(nfft + 1)[:-1]
    pad = nfft
    xp = np.concatenate([np.zeros(pad), x, np.zeros(pad + hop)])
    nfrm = (len(xp) - nfft) // hop + 1
    idx = np.arange(nfft)[None, :] + hop * np.arange(nfrm)[:, None]
    X = np.fft.rfft(xp[idx] * win, axis=1)
    freqs = np.fft.rfftfreq(nfft, 1.0 / SR)[None, :]
    tc = ((hop * np.arange(nfrm) + nfft / 2 - pad) / SR)[:, None]
    Y = np.fft.irfft(X * maskfn(freqs, tc), n=nfft, axis=1) * win
    y = np.zeros(nfrm * hop + 5 * nfft)
    for r in range(4):
        rows = Y[r::4]
        st = r * hop
        y[st:st + rows.size] += rows.reshape(-1)
    return y[pad:pad + n] / 1.5


def shaped_noise(n, seed, maskfn):
    y = stft_shape(noise(n, seed), maskfn)
    y = y / (np.sqrt(np.mean(y ** 2)) + 1e-12)
    return 2.6 * np.tanh(y / 2.6)          # shave Gaussian crests (> ~2.6 sigma)


def fft_static(x, maskf, pad=8192):
    """zero-phase static filter (short buffers / sends)."""
    n = x.shape[-1]
    m = n + 2 * pad
    xp = np.zeros(x.shape[:-1] + (m,))
    xp[..., pad:pad + n] = x
    f = np.fft.rfftfreq(m, 1.0 / SR)
    return np.fft.irfft(np.fft.rfft(xp, axis=-1) * maskf(f), n=m, axis=-1)[..., pad:pad + n]


def iir_fft(x, b, a, pad=SR):
    """Causal biquad applied exactly through its complex frequency response."""
    n = x.shape[-1]
    m = n + pad
    xp = np.zeros(x.shape[:-1] + (m,))
    xp[..., :n] = x
    w = TWO_PI * np.fft.rfftfreq(m, 1.0)
    z1 = np.exp(-1j * w)
    H = (b[0] + b[1] * z1 + b[2] * z1 * z1) / (a[0] + a[1] * z1 + a[2] * z1 * z1)
    return np.fft.irfft(np.fft.rfft(xp, axis=-1) * H, n=m, axis=-1)[..., :n]


def biquad_hp(fc, q=0.7071):
    w0 = TWO_PI * fc / SR
    al = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    b = np.array([(1 + c) / 2, -(1 + c), (1 + c) / 2])
    a = np.array([1 + al, -2 * c, 1 - al])
    return b / a[0], a / a[0]


# ----------------------------------------------------------------- reverb --
COMB = np.array([1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]) * SR / 44100.0
APD = np.array([556, 441, 341, 225]) * SR / 44100.0


def comb_block(x, D, g):
    y = x.copy()
    n = len(y)
    for s in range(D, n, D):
        e = min(s + D, n)
        y[s:e] += g * y[s - D:e - D]
    return y


def allpass_block(x, D, g):
    n = len(x)
    y = -g * x
    y[D:] += x[:-D]
    for s in range(D, n, D):
        e = min(s + D, n)
        y[s:e] += g * y[s - D:e - D]
    return y


def schroeder(x, t60, size, spread):
    out = np.zeros_like(x)
    energy = 0.0
    for D0 in COMB:
        D = int(D0 * size) + spread
        g = 10.0 ** (-3.0 * D / (SR * t60))
        out += comb_block(x, D, g)
        energy += 1.0 / (1.0 - g * g)
    out *= 1.0 / np.sqrt(energy)          # unit-energy impulse response
    for D0 in APD:
        out = allpass_block(out, int(D0) + spread, 0.5)
    return out


def reverb(send, t60_lo, t60_hi, xover=1500.0, predelay=0.02, size=1.0,
           hp_in=100.0, lp_in=9000.0, wid=1.0):
    m = 0.5 * (send[0] + send[1])
    if not np.any(m):
        return np.zeros_like(send)
    m = fft_static(m, lambda f: m_hp(f, hp_in) * m_lp(f, lp_in))
    d = secs(predelay)
    m = np.concatenate([np.zeros(d), m[:len(m) - d]])
    lo = fft_static(m, lambda f: m_lp(f, xover, 2))
    hi = m - lo
    outs = []
    for spread in (0, 23):
        outs.append(schroeder(lo, t60_lo, size, spread) + schroeder(hi, t60_hi, size, spread))
    w1 = wid / 2 + 0.5
    w2 = (1 - wid) / 2
    return np.vstack([outs[0] * w1 + outs[1] * w2, outs[1] * w1 + outs[0] * w2])


# -------------------------------------------------------------------- mix --
class Mix:
    def __init__(self):
        self.b = {}

    def bus(self, seg, name):
        k = (seg, name)
        if k not in self.b:
            self.b[k] = np.zeros((2, N))
        return self.b[k]

    def add(self, name, start, sig, gain_db=0.0, room=0.0, hall=0.0, seg=None):
        sig = np.atleast_2d(np.asarray(sig, dtype=float))
        if sig.shape[0] == 1:
            sig = np.vstack([sig, sig])
        if seg is None:
            seg = "A" if start < CUT_A else "B"
        n = sig.shape[1]
        s0, s1 = max(start, 0), min(start + n, N)
        if s1 <= s0:
            return
        piece = sig[:, s0 - start:s1 - start] * dbg(gain_db)
        self.bus(seg, name)[:, s0:s1] += piece
        if room:
            self.bus(seg, "room")[:, s0:s1] += piece * room
        if hall:
            self.bus(seg, "hall")[:, s0:s1] += piece * hall


MX = Mix()


# ------------------------------------------------------ sound primitives --
def thump(f_hi, f_lo, att, tau, length, drop_tau=0.03, drive=1.6, glide=None):
    n = secs(length)
    t = np.arange(n) / SR
    if glide is None:
        fr = f_lo + (f_hi - f_lo) * np.exp(-t / drop_tau)
    else:  # exponential glide f_hi -> f_lo over `glide` seconds
        fr = expmap(f_hi, f_lo, t / glide)
    return soft(sine(fr), drive) * perc(n, att, tau)


def kick(vel=1.0, tail=0.0, seed=7):
    n = secs(0.55 + tail)
    t = np.arange(n) / SR
    fr = 47.0 + 105.0 * np.exp(-t / 0.026)
    body = soft(sine(fr), 2.0) * perc(n, 0.0012, 0.15)
    click = fft_static(noise(n, seed) * perc(n, 0.0002, 0.0012), lambda f: m_hp(f, 1800) * m_lp(f, 9000))
    click /= np.max(np.abs(click)) + 1e-9
    y = body + 0.16 * click
    if tail:
        y += 0.45 * sine(45.0, n) * perc(n, 0.02, tail)
    return y * vel


def make_tick(seed=15):
    """the cursor tick: 2 ms high-passed noise burst around 3 kHz + tiny ring."""
    n = secs(0.03)
    t = np.arange(n) / SR
    burst = noise(n, seed) * perc(n, 0.0002, 0.0006)
    burst = fft_static(burst, lambda f: m_bp(f, 3000, 0.9) + 0.35 * m_hp(f, 5000))
    burst /= np.max(np.abs(burst)) + 1e-9
    ring = np.sin(TWO_PI * 3000 * t) * perc(n, 0.0003, 0.0028)
    return edge_fade(burst + 0.32 * ring, 0.0002, 0.004)


def keystroke(seed, pitch=1.0, close=False):
    n = secs(0.07)
    t = np.arange(n) / SR
    nz = noise(n, seed) * perc(n, 0.00025, 0.0007 if close else 0.0011)
    nz = fft_static(nz, lambda f: m_hp(f, 900) * m_lp(f, 11000))
    nz /= np.max(np.abs(nz)) + 1e-9
    ping = np.sin(TWO_PI * 2400 * pitch * t) * perc(n, 0.0004, 0.006 if close else 0.011)
    body = np.sin(TWO_PI * 170 * pitch * t) * perc(n, 0.0008, 0.010 if close else 0.013)
    y = nz + 0.42 * ping + (0.55 if close else 0.22) * body
    return edge_fade(y / (np.max(np.abs(y)) + 1e-9), 0.0002, 0.006)


def glass(f, tau=0.12, length=0.6, seed=3):
    n = secs(length)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for ratio, amp in ((1.0, 1.0), (2.756, 0.26), (5.404, 0.08)):
        if f * ratio < 0.45 * SR:
            y += amp * np.sin(TWO_PI * f * ratio * t) * perc(n, 0.0007, tau / ratio ** 0.6)
    tr = fft_static(noise(n, seed) * perc(n, 0.0001, 0.0005), lambda q: m_hp(q, 4000))
    y += 0.12 * tr / (np.max(np.abs(tr)) + 1e-9)
    return edge_fade(y / (np.max(np.abs(y)) + 1e-9), 0.0004, 0.01)


def rev_swell(n, seed, maskfn, curve=3.2, cut=0.0015):
    """reversed-reverb style swell: exponential rise into a dead stop."""
    t = np.arange(n) / SR
    T = n / SR
    x = shaped_noise(n, seed, maskfn)
    env = np.exp((t - T) / (T / curve)) * ease_io(t / (0.25 * T))
    env = edge_fade(env, 0.0, cut)
    return x * env


def grains_env(n, seed, rate, glen=(0.004, 0.016)):
    r = rng(seed)
    e = np.zeros(n)
    tt = 0.0
    T = n / SR
    while True:
        tt += r.exponential(1.0 / rate)
        if tt >= T:
            break
        L = secs(r.uniform(*glen))
        s = secs(tt)
        g = np.hanning(L + 2)[1:-1] * r.uniform(0.3, 1.0)
        e[s:s + L] += g[:max(0, min(L, n - s))]
    return e


def flyby(seed, fc, side, tau, dop=0.28, bw=0.55, body=0.35, spread=0.75, haas_ms=0.0):
    pre, post = secs(7 * tau), secs(9 * tau)
    n = pre + post
    t = (np.arange(n) - pre) / SR
    t_off = pre / SR

    def mk(f, tc):
        tt = tc - t_off
        fct = fc * (1.0 - dop * np.tanh(tt / tau))
        return m_bp(f, fct, bw) + body * m_bp(f, fct * 0.35, 0.9)

    x = shaped_noise(n, seed, mk)
    k_ = np.hanning(secs(0.03))
    k_ /= k_.sum()
    x = x / np.sqrt(np.convolve(x * x, k_, mode="same") + 1e-3)
    x = 2.6 * np.tanh(x / 2.6)
    env = 1.0 / (1.0 + (t / (tau * np.where(t < 0, 1.0, 1.35))) ** 2)
    env *= ease_io((t + 7 * tau) / (2.5 * tau)) * ease_io((9 * tau - t) / (3 * tau))
    p = side * (0.15 + spread * (0.5 + 0.5 * np.tanh(t / tau)))
    st = pan(x * env, p)
    if haas_ms:
        st = haas(st, haas_ms, delay_ch=0 if side > 0 else 1)
    return st, pre


def pad(notes, gains, n, cutoff, bend=None, seed=0, cents=((-6, 4), (-3, 7)),
        lfo=(0.15, 0.31), depth=3.0, order=3, lim=3.0):
    t = np.arange(n) / SR
    r = rng(seed)
    out = np.zeros((2, n))
    for f0, g in zip(notes, gains):
        for ch in (0, 1):
            for c in cents[ch]:
                fr = f0 * 2.0 ** ((c + depth * np.sin(TWO_PI * r.uniform(*lfo) * t + r.uniform(0, TWO_PI))) / 1200.0)
                if bend is not None:
                    fr = fr * bend
                out[ch] += saw_voice(fr, cutoff, order=order, lim=lim) * g / len(cents[ch])
    return out


def frames_axis(f0, f1):
    return f0 + np.arange(F(f1) - F(f0)) / SPF


# ===================================================================== SCORE
print("synth ...", flush=True)
TICK = make_tick()
HEART = thump(72, 55, 0.006, 0.07, 0.45)
HEART_BODY = fft_static(noise(secs(0.45), 151) * perc(secs(0.45), 0.004, 0.03), lambda f: m_lp(f, 300, 2))
HEART_BODY /= np.max(np.abs(HEART_BODY)) + 1e-9
HEARTBEAT = HEART + 0.12 * HEART_BODY

# --- 0-580 drone + room tone --------------------------------------------
fr = frames_axis(0, 580)
n = len(fr)
lfo = 1.0 + 0.08 * np.sin(TWO_PI * 0.09 * fr / FPS)
grow = dbg(3.0 * ease_io((fr - 40) / 485.0))
drone_env = ease_io(fr / 40.0) * lfo * grow
drone = (sine(38.0, n) + 0.25 * sine(76.0, n, 0.4) + 0.06 * sine(114.0, n, 1.1)) * drone_env
MX.add("bed", 0, np.vstack([drone, drone]), -24.0)
hiss = np.vstack([shaped_noise(n, 11, lambda f, t: m_lp(f, 3500) * m_hp(f, 250)),
                  shaped_noise(n, 12, lambda f, t: m_lp(f, 3500) * m_hp(f, 250))])
MX.add("bed", 0, hiss * ease_io(fr / 40.0), -63.0)

# --- 15 / 30 / 45 heartbeats + 45-72 keystrokes --------------------------
MX.add("hits", F(15), HEARTBEAT, -6.0, room=0.12)
MX.add("ticks", F(15), TICK, -14.0, room=0.25)
MX.add("hits", F(30), HEARTBEAT, -9.0, room=0.12)
MX.add("ticks", F(30), TICK, -17.0, room=0.25)
MX.add("hits", F(45), HEARTBEAT, -11.0, room=0.12)
r = rng(45)
for i in range(10):
    f = 45 + 3 * i
    k = keystroke(450 + i, pitch=1.0 + r.uniform(-0.05, 0.05))
    MX.add("ticks", F(f), pan(k, -0.15 + 0.35 * i / 9), -16.0 + r.uniform(-1.5, 1.5), room=0.22)

# --- 45-78 macro pull-out air whoosh (LP 300 -> 1.8k) --------------------
n = F(84) - F(45)
T = (F(78) - F(45)) / SR
wh = np.vstack([shaped_noise(n, s, lambda f, t: m_lp(f, expmap(300, 1800, t / T), 2) * m_hp(f, 60)) for s in (451, 452)])
e = ease_io(np.arange(n) / (0.65 * n)) * ease_io((n - np.arange(n)) / (0.4 * n))
MX.add("fx", F(45), wh * e, -31.0, hall=0.15)

# --- 76 'undefined' glass tone -------------------------------------------
n = secs(1.0)
t = np.arange(n) / SR
drift = 2.0 ** (-15.0 / 1200.0 * ease_out(t / 0.8))
und = (sine(196.0 * drift) + 0.55 * sine(392.0 * drift * 1.0015, phase0=0.7) + 0.35 * sine(196.0 * 1.004 * drift, phase0=1.3))
und = fft_static(und * perc(n, 0.008, 0.11, hold=0.02), lambda f: m_lp(f, 1500))
MX.add("tones", F(76), pan(und / np.max(np.abs(und)), 0.05), -14.0, room=0.3, hall=0.25)

# --- 96-119 reverse swell, cut dead at end of 119 -------------------------
n = F(120) - F(96)
sw = np.vstack([rev_swell(n, s, lambda f, t: m_bp(f, 900, 1.6) * m_lp(f, 5000)) for s in (961, 962)])
MX.add("fx", F(96), sw, -23.0)

# --- 120 line stretch: centre -> full width whoosh + 55 Hz thump -----------
n = F(152) - F(120)
fr = frames_axis(120, 152)
nl = shaped_noise(n, 1201, lambda f, t: m_bp(f, expmap(1200, 2600, t / 0.66), 1.1))
nr = shaped_noise(n, 1202, lambda f, t: m_bp(f, expmap(1200, 2600, t / 0.66), 1.1))
st = np.vstack([nl, nr])
st = width(st, ease_io((fr - 120) / 20.0))
e = ease_io((fr - 120) / 1.2) * np.where(fr < 136, 1.0, np.exp(-(fr - 136) / 6.0))
MX.add("fx", F(120), edge_fade(st * e, 0.002, 0.03), -27.0, hall=0.2)
MX.add("hits", F(120), thump(70, 55, 0.004, 0.05, 0.35), -10.0)

# --- 120-374 tempo bed: hi-ticks; beats -> 8ths (300) -> 16ths (345) -------
HITICK = glass(5200, tau=0.022, length=0.12, seed=21)
pulse_times = [120 + 15 * k for k in range(13)]          # 120 ... 300
pulse_times += [300 + 7.5 * k for k in range(1, 6)]       # 307.5 ... 337.5 (8ths)
pulse_times += [345 + 3.75 * k for k in range(8)]         # 345 ... 371.25 (16ths)
for i, f in enumerate(pulse_times):
    lvl = -26.0 + 6.0 * np.clip((f - 120) / 240.0, 0, 1) + (0.6 if f > 360 else 0)
    MX.add("ticks", F(f), pan(HITICK, 0.12 * (-1) ** i), lvl, room=0.18)

# --- 140/143/146 glassy grid ticks ----------------------------------------
for f, hz, p in ((140, 2400, -0.25), (143, 2700, 0.0), (146, 3000, 0.25)):
    MX.add("ticks", F(f), pan(glass(hz, tau=0.09, length=0.5, seed=f), p), -18.0, room=0.25, hall=0.2)

# --- 150-176 granular shimmer (BP 2 -> 6 kHz, centre-out stereo) -----------
n = F(186) - F(150)
fr = frames_axis(150, 186)
T = (F(176) - F(150)) / SR
chs = []
for s in (1501, 1502):
    x = shaped_noise(n, s, lambda f, t: m_bp(f, expmap(2000, 6000, t / T), 0.45))
    chs.append(x * grains_env(n, s + 10, 260.0))
st = width(np.vstack(chs), ease_io((fr - 150) / 26.0))
e = ease_io((fr - 150) / 8.0) * ease_io((186 - fr) / 12.0)
MX.add("fx", F(150), st * e, -31.0, room=0.2, hall=0.3)

# --- 166 origin blip --------------------------------------------------------
n = secs(0.04)
blip = edge_fade(np.sin(TWO_PI * 1600 * np.arange(n) / SR) * ease_io(1 - np.arange(n) / n) ** 1.5, 0.003, 0.004)
MX.add("ticks", F(166), blip, -22.0, room=0.3)

# --- 188-224 tonal riser (detuned saws, +5 st, rising LP) -----------------
fr = frames_axis(188, 245)
n = len(fr)
x = (fr - 188) / 34.0
bend = 2.0 ** (5.0 / 12.0 * ease_io(x))
cut = expmap(250, 3500, ease_in(x, 1.6))
rz = pad([110.0, 220.0], [1.0, 0.45], n, cut, bend=bend, seed=188, cents=((-9, 5), (-5, 10)))
rz[0] += 0.3 * sine(55.0 * bend)
rz[1] += 0.3 * sine(55.0 * bend)
e = ease_in((fr - 188) / 37.0, 1.8) * np.where(fr < 225, 1.0, np.exp(-(fr - 225) / 4.5))
MX.add("fx", F(188), edge_fade(rz * e, 0.01, 0.02), -21.0, hall=0.2)

# --- 225 downbeat: sub hit 50->38 Hz + wide whoosh; kicks every other beat ---
MX.add("hits", F(225), thump(50, 38, 0.003, 0.35, 1.3, glide=0.4, drive=1.8), -9.0)
n = secs(0.9)
t = np.arange(n) / SR
wh = np.vstack([shaped_noise(n, s, lambda f, tt: m_lp(f, expmap(6000, 400, tt / 0.6), 2) * m_hp(f, 80)) for s in (2251, 2252)])
MX.add("fx", F(225), haas(wh * perc(n, 0.006, 0.18), 7.0), -19.0, hall=0.25)
for i, f in enumerate((225, 255, 285, 315, 345)):
    MX.add("hits", F(f), kick(1.0), (-12.0 if i == 0 else -10.5) + 0.5 * i)


BR_STEM = np.zeros(N)
# --- 294..366 bracket passes (doppler whoosh-bys peaking on the frame) -----
def cam_speed(f):
    p = (np.asarray(f, dtype=float) - 225.0) / 149.0
    return 0.35 + 2.6 * p ** 3


for j, (f, st_, lvl) in enumerate(((294, 0, -21.5), (324, 2, -20.5), (342, 4, -19.5), (356, 6, -18.0), (366, 8, -17.5))):
    tau = 0.10 * np.sqrt(cam_speed(294) / cam_speed(f))
    fc = 750.0 * 2.0 ** (st_ / 12.0)
    wide = f >= 356
    for side, sd in ((-1, 0), (1, 1)):
        stw, pre = flyby(2940 + 10 * j + sd, fc * (1.0 if side < 0 else 1.06), side, tau,
                         spread=0.82 if wide else 0.7, haas_ms=9.0 if wide else 3.0)
        MX.add("fx", F(f) - pre, stw, lvl, hall=0.12)
        BR_STEM[F(f) - pre:F(f) - pre + stw.shape[1]] += np.abs(stw).sum(0) * dbg(lvl)

# 366-375 anamorphic flare: high sine sweep 4 -> 9 kHz
fr = frames_axis(366, 375)
n = len(fr)
fl = sine(expmap(4000, 9000, (fr - 366) / 9.0)) * np.sin(np.pi * np.clip((fr - 366) / 9.0, 0, 1)) ** 0.7
MX.add("fx", F(366), pan(edge_fade(fl, 0.003, 0.002), 0.2), -31.0, hall=0.35)

# --- 300-374 long riser, pitch tracks the corridor speed ramp (+12 st) -----
fr = frames_axis(300, 375)
n = len(fr)
v = cam_speed(np.minimum(fr, 374.0))
v0, v1 = float(cam_speed(300)), float(cam_speed(374))
semi = 12.0 * np.log(v / v0) / np.log(v1 / v0)
ratio = 2.0 ** (semi / 12.0)
prog = (v - v0) / (v1 - v0)
t_rel = np.arange(n) / SR


def riser_mask(f, tc):
    rr = np.interp(tc, t_rel, ratio)
    return m_bp(f, 520.0 * rr, 0.45) + 0.35 * m_hp(f, 3000.0 * rr) * m_lp(f, 14000)


rs = np.vstack([shaped_noise(n, s, riser_mask) for s in (3001, 3002)])
ton = pad([110.0, 220.0], [0.8, 0.5], n, 600.0 + 3400.0 * prog ** 1.2, bend=ratio, seed=300, cents=((-7, 6), (-4, 9)))
trem = 1.0 - 0.18 * (0.5 + 0.5 * np.sin(TWO_PI * np.cumsum(6.0 + 18.0 * prog) / SR))
env = (0.12 + 0.88 * prog ** 0.75) * ease_io(np.arange(n) / secs(0.8)) * trem
env = edge_fade(env, 0.0, 0.002)                              # cut dead at end of 374
MX.add("fx", F(300), (rs * 0.9 + ton * 0.8) * env, -17.0, hall=0.12)

# --- 375 impact: deep whoomp + LP noise burst; tape-stop 375-405 ----------
MX.add("hits", F(375), thump(70, 45, 0.003, 0.3, 1.1, drop_tau=0.05, drive=2.0), -6.0, hall=0.08)
n = secs(0.6)
bb = np.vstack([fft_static(noise(n, s), lambda f: m_lp(f, 280, 2)) for s in (3751, 3752)])
bb /= np.max(np.abs(bb))
MX.add("hits", F(375), bb * perc(n, 0.004, 0.12), -10.0, hall=0.15)
fr = frames_axis(375, 406)
n = len(fr)
x = (fr - 375) / 30.0
rate = np.maximum(np.clip(1.0 - x, 0.0, 1.0) ** 1.6, 0.06)
ts = pad([110.0, 220.0], [0.8, 0.5], n, 120.0 + 3000.0 * rate, bend=2.0 * rate, seed=375, cents=((-7, 6), (-4, 9)))
tn = np.vstack([stft_shape(noise(n, s), lambda f, tc: m_bp(f, 1100.0 * np.interp(tc, np.arange(n) / SR, rate) + 60, 0.8)) for s in (3753, 3754)])
tn /= np.sqrt(np.mean(tn ** 2))
e = rate ** 0.6 * ease_io(np.arange(n) / secs(0.004))
MX.add("fx", F(375), edge_fade((ts + 0.4 * tn) * e, 0.002, 0.03), -20.0, hall=0.15)

# --- 400-551 granular crackle, density rising 400 -> 470 -------------------
r = rng(400)
tt = 400.0
while True:
    if tt < 470:
        dens = 15.0 + 125.0 * (tt - 400) / 70.0
    elif tt < 525:
        dens = 140.0
    else:
        dens = 140.0 - 90.0 * (tt - 525) / 26.0
    tt += r.exponential(1.0 / dens) * FPS
    if tt >= 549:
        break
    g = np.arange(secs(0.004)) / SR
    hz = np.exp(r.uniform(np.log(1500), np.log(9000)))
    gr = np.sin(TWO_PI * hz * g) * np.exp(-g / r.uniform(0.00015, 0.0008)) * r.choice([-1, 1])
    lvl = -34.0 + 8.0 * min(1.0, (tt - 400) / 70.0) + r.normal(0, 3.0)
    fade = 1.0 if tt < 538 else ease_io((549 - tt) / 11.0)
    MX.add("fx", F(tt), pan(edge_fade(gr, 0.00005, 0.001) * fade, r.uniform(-0.95, 0.95)), lvl, room=0.25)

# --- 455-580 A minor pad (A1 E2 C3), LP 400 -> 3k, bends -1 st over 525-551 ---
fr = frames_axis(455, 580)
n = len(fr)
cut = np.where(fr < 525, expmap(400, 3000, ease_io((fr - 455) / 69.0)), expmap(3000, 1600, ease_io((fr - 525) / 26.0)))
bend = 2.0 ** (-ease_io((fr - 525) / 26.0) / 12.0)
mp = pad([55.0, 82.41, 130.81], [1.0, 0.75, 0.6], n, cut, bend=bend, seed=455)
sub = 0.35 * sine(55.0 * bend)
mp += np.vstack([sub, sub])
e = ease_in((fr - 455) / 69.0, 1.6) * np.where(fr < 551, 1.0, dbg(-6.0))
MX.add("bed", F(455), mp * e, -17.5, hall=0.25)

# --- 465-510 beat-locked sphere kicks, velocity rising ----------------------
for i, f in enumerate((465, 480, 495, 510)):
    MX.add("hits", F(f), kick(1.0, tail=0.35, seed=465 + i), -11.0 + 2.0 * i, hall=0.05)

# --- 525-551 reversed cymbal suck-in ---------------------------------------
n = F(551) - F(525)
fr = frames_axis(525, 551)
T = n / SR
met = np.zeros(n)
for hz in (205.3, 304.4, 369.6, 522.7, 540.0, 800.0):
    met += np.sign(np.sin(TWO_PI * hz * 2.0 * np.arange(n) / SR + hz))
met = fft_static(met, lambda f: m_hp(f, 3500, 2))
met /= np.sqrt(np.mean(met ** 2))
cy = []
for s in (5251, 5252):
    x = shaped_noise(n, s, lambda f, t: m_hp(f, 2500, 2) * m_lp(f, expmap(3000, 14000, t / T), 2))
    cy.append(x + 0.35 * met)
cy = np.vstack(cy)
env = np.exp((np.arange(n) / SR - T) / (T / 4.0)) * ease_io(np.arange(n) / (0.2 * n))
MX.add("fx", F(525), edge_fade(cy * env, 0.0, 0.0015), -21.0, hall=0.1)

# --- 551 felt thump + glint -------------------------------------------------
MX.add("hits", F(551), thump(85, 70, 0.005, 0.04, 0.3, drive=1.4), -8.5)
n = secs(0.3)
gl = np.sin(TWO_PI * 6000 * np.arange(n) / SR) * perc(n, 0.0005, 0.035)
MX.add("ticks", F(551), pan(gl, 0.1), -30.0, hall=0.4)

# --- 556-570 'light = ' keystrokes, close-miked ------------------------------
r = rng(556)
for i in range(8):
    f = 556 + 2 * i
    k = keystroke(5560 + i, pitch=1.0 + r.uniform(-0.05, 0.05), close=True)
    MX.add("ticks", F(f), pan(k, -0.05 + 0.1 * i / 7), -11.0 + r.uniform(-1.5, 1.5), room=0.06)

# 588 'inhale' omitted on purpose: the director's brief requires true digital silence 580-599.

# =================================================================== B ====
# --- 600 IGNITION -------------------------------------------------------------
n = secs(3.0)
t = np.arange(n) / SR
subd = soft(sine(expmap(80.0, 32.0, t / 0.6)), 2.2) * perc(n, 0.0015, 0.48, hold=0.06)
ign = np.vstack([subd, subd]) * 1.0
# transient crack
nc = secs(0.08)
cr = []
for s in (6001, 6002):
    c = noise(nc, s) * (perc(nc, 0.0001, 0.003) + 0.25 * perc(nc, 0.0002, 0.014))
    c = fft_static(c, lambda f: m_hp(f, 700, 2))
    cr.append(c / np.max(np.abs(c)))
snap = np.sin(TWO_PI * 2200 * np.arange(nc) / SR) * perc(nc, 0.0002, 0.004)
crack = np.vstack(cr) + 0.3 * snap
ign[:, :nc] += 0.6 * edge_fade(crack, 0.0002, 0.01)
# wide white-noise burst, LP closing
nb_ = secs(2.2)
burst = np.vstack([shaped_noise(nb_, s, lambda f, tt: m_lp(f, 1400.0 + 15000.0 * np.exp(-np.maximum(tt, 0) / 0.22), 2) * m_hp(f, 60)) for s in (6003, 6004)])
burst *= perc(nb_, 0.002, 0.33)
ign[:, :nb_] += 0.30 * burst
# low saw-stack brass blast D2 A2 D3
nbr = secs(2.8)
tb = np.arange(nbr) / SR
fcut = 260.0 + 3000.0 * ease_out(tb / 0.06) * np.exp(-np.maximum(tb - 0.06, 0) / 0.45)
br = pad([73.42, 110.0, 146.83], [1.0, 0.8, 0.6], nbr, fcut, seed=600, cents=((-8, 5), (-5, 8)), order=2, lim=3.0)
br = soft(br * 1.6, 1.5) * perc(nbr, 0.012, 0.75)
ign[:, :nbr] += 0.42 * br
ign = knee(ign, 0.75)
MX.add("ign", IGN, edge_fade(ign, 0.0006, 0.05), -4.0, hall=0.24, seg="B")

# --- 600-632 shockwave whoosh (outward, widening) + low rumble tail -----------
fr = frames_axis(600, 640)
n = len(fr)
T = (F(628) - F(600)) / SR
st = np.vstack([shaped_noise(n, s, lambda f, tt: m_bp(f, expmap(4500, 450, tt / T), 1.2)) for s in (6011, 6012)])
st = width(st, 0.2 + 0.8 * ease_out((fr - 600) / 28.0))
e = ease_io((fr - 600) / 5.0) * np.where(fr < 606, 1.0, np.exp(-(fr - 606) / 9.0)) * ease_io((640 - fr) / 10.0)
MX.add("fx", IGN, haas(st * e, 6.0), -15.0, hall=0.3, seg="B")
rb = np.vstack([shaped_noise(n, s, lambda f, tt: m_lp(f, 110, 3) * m_hp(f, 22)) for s in (6013, 6014)])
e = ease_io((fr - 600) / 3.0) * ease_io((632 - fr) / 16.0)
MX.add("hits", IGN, rb * e, -23.0, seg="B")

# --- 606-839 the light chord: D2 A2 F#3 E4 (add9), swell 606-690 -------------
fr = frames_axis(606, 840)
n = len(fr)
cut = np.where(fr < 690, expmap(320, 1700, ease_io((fr - 606) / 84.0)),
               np.where(fr < 666, 1700.0, 1700.0))
cut = np.where((fr >= 666) & (fr < 705), expmap(1700, 1150, ease_io((fr - 666) / 38.0)), cut)
cut = np.where(fr >= 705, expmap(1150, 1400, ease_io((fr - 705) / 40.0)), cut)
lc = pad([73.42, 110.0, 185.0, 329.63], [1.0, 0.8, 0.62, 0.42], n, cut, seed=606, depth=3.5, order=3, lim=2.6)
lsub = 0.4 * sine(73.42, n)
lc += np.vstack([lsub, lsub])
e = ease_io((fr - 606) / 84.0) ** 1.3 * np.where(fr < 780, 1.0, ease_io((800 - fr) / 20.0))
MX.add("bed", F(606), lc * e, -16.5, hall=0.22, seg="B")
# 780: resolve to a single D3 over a soft D1 sub, decaying into the hold
fr2 = frames_axis(780, 840)
n2 = len(fr2)
d3 = pad([146.83], [1.0], n2, 900.0, seed=780, depth=2.5)
d1 = 0.8 * sine(36.71, n2)
res = d3 + np.vstack([d1, d1])
e = ease_io((fr2 - 780) / 20.0) * np.where(fr2 < 800, 1.0, np.exp(-(fr2 - 800) / 22.0))
MX.add("bed", F(780), res * e, -18.0, hall=0.25, seg="B")

# --- 628-650 ray reveal: 18 glassy ticks, ascending D-major pentatonic ----------
penta = [0, 2, 4, 7, 9]
for i in range(18):
    semi = 12 * (i // 5) + penta[i % 5]
    hz = 587.33 * 2.0 ** (semi / 12.0)
    f = 628 + i * 22.0 / 17.0
    p = -0.6 + 1.2 * i / 17 + 0.15 * (-1) ** i
    MX.add("ticks", F(f), pan(glass(hz, tau=0.2 * (587.33 / hz) ** 0.3, length=0.8, seed=6280 + i), p),
           -25.0 - 6.0 * i / 17, room=0.2, hall=0.55, seg="B")

# --- 666-704 reverse swell into the full stop ----------------------------------
n = F(705) - F(666)
T = n / SR
sw = np.vstack([rev_swell(n, s, lambda f, t: m_lp(f, expmap(900, 5000, t / T), 2) * m_hp(f, 120), curve=3.6) for s in (6661, 6662)])
MX.add("fx", F(666), sw, -23.5, hall=0.15, seg="B")

# --- 705 the tonk (110 + 220 Hz, 600 ms) with a gentle sub ----------------------
n = secs(1.0)
t = np.arange(n) / SR
pd_ = 1.0 + 0.03 * np.exp(-t / 0.012)
tk = sine(110.0 * pd_) + 0.5 * sine(220.0 * pd_, phase0=0.4)
tk = tk * perc(n, 0.002, 0.2) + 0.45 * sine(55.0, n) * perc(n, 0.004, 0.25)
mal = fft_static(noise(n, 705) * perc(n, 0.0003, 0.002), lambda f: m_lp(f, 1500))
tk = knee(tk + 0.25 * mal / np.max(np.abs(mal)), 0.8)
MX.add("hits", F(705), tk, -10.5, hall=0.3, seg="B")

# --- 707-747 title glyphs rise: soft airy upward whoosh ----------------------------
fr = frames_axis(707, 755)
n = len(fr)
T = (F(747) - F(707)) / SR
st = np.vstack([shaped_noise(n, s, lambda f, tt: m_bp(f, expmap(700, 6000, ease_io(tt / T)), 1.3)) for s in (7071, 7072)])
e = ease_in((fr - 707) / 28.0, 1.5) * np.where(fr < 735, 1.0, ease_io((755 - fr) / 20.0))
MX.add("fx", F(707), width(st * e, 0.9), -31.0, hall=0.2, seg="B")

# --- 750 the bell: 880 + 1760 Hz, long tail ------------------------------------------
n = F(840) - F(750)
t = np.arange(n) / SR
bell = sine(880.0, n) * perc(n, 0.0015, 1.3) + 0.45 * sine(1760.0, n, 0.3) * perc(n, 0.0015, 0.7)
bell += 0.03 * sine(880.0 * 2.76, n) * perc(n, 0.001, 0.25)
MX.add("tones", F(750), pan(bell, 0.08), -19.0, room=0.1, hall=0.6, seg="B")

# --- 752-764 four faint credit ticks ------------------------------------------------
for i, f in enumerate((752, 756, 760, 764)):
    MX.add("ticks", F(f), pan(glass(7040.0 * (1.0 + 0.02 * i), tau=0.02, length=0.1, seed=752 + i), -0.3 + 0.2 * i),
           -42.0, room=0.3, seg="B")

# --- 776-806 specular shimmer panned L -> R ---------------------------------------------
fr = frames_axis(776, 812)
n = len(fr)
x = shaped_noise(n, 7761, lambda f, t: m_bp(f, 8000, 0.5)) * grains_env(n, 7762, 220.0)
e = np.sin(np.pi * np.clip((fr - 776) / 32.0, 0, 1)) ** 1.5
MX.add("fx", F(776), pan(x * e, -0.85 + 1.7 * ease_io((fr - 776) / 30.0)), -40.0, hall=0.3, seg="B")

# ================================================================ MIX DOWN ====
print(f"  synth done {time.time() - T0:.1f}s; mixing ...", flush=True)


def duck(bed, key, depth_db=5.0, att=0.003, rel=0.25, ref=0.45):
    k = np.max(np.abs(key), axis=0)
    blk = 48
    nb = N // blk
    kb = k[:nb * blk].reshape(nb, blk).max(1).tolist()
    a = np.exp(-1.0 / (att * 1000.0))
    rr = np.exp(-1.0 / (rel * 1000.0))
    env = []
    v = 0.0
    for s in kb:
        v = a * v + (1 - a) * s if s > v else rr * v + (1 - rr) * s
        env.append(v)
    gr = dbg(-depth_db * np.clip(np.array(env) / ref, 0, 1))
    g = np.interp(np.arange(N), np.arange(nb) * blk + blk / 2, gr)
    return bed * g


def seg_mix(seg):
    z = np.zeros((2, N))
    g = lambda name: MX.b.get((seg, name), z)
    hits = g("hits") + g("ign")
    bed = duck(g("bed"), hits, depth_db=5.0)
    dry = hits + g("fx") + g("ticks") + g("tones") + bed
    room = reverb(g("room"), 1.2, 0.8, predelay=0.008, size=0.75, hp_in=200, lp_in=8000, wid=0.8)
    hall = reverb(g("hall"), 4.8 if seg == "B" else 3.2, 2.4 if seg == "B" else 1.8, predelay=0.025, size=1.3,
                  hp_in=110, lp_in=7500, wid=1.0)
    hall = duck(hall, hits, depth_db=2.0, rel=0.4)
    return dry + 0.55 * room + 0.75 * hall


for (sg, nm), arr in sorted(MX.b.items()):
    pk_i = int(np.argmax(np.max(np.abs(arr), axis=0)))
    print(f"  bus {sg}/{nm:<6} peak {20*np.log10(np.max(np.abs(arr))+1e-12):6.1f} dBFS at frame {pk_i/SPF:6.1f}")
A = seg_mix("A")
B = seg_mix("B")
sidx = np.arange(N)
maskA = np.where(sidx < CUT_A, 1.0, 0.0)
fz = secs(0.003)
maskA[CUT_A - fz:CUT_A] = ease_io(np.arange(fz)[::-1] / (fz - 1))
maskB = (sidx >= IGN).astype(float)
endfade = np.where(sidx < F(800), 1.0, ease_io((N - 1 - sidx) / (N - 1 - F(800))) ** 1.2)

# bookend tick at 819 (the frame-15 tick + a soft heartbeat), its own short room
bk = np.zeros((2, N))
bk[:, F(819):F(819) + len(TICK)] += TICK * dbg(-16.0)
hb = HEARTBEAT * dbg(-15.0)
bk[:, F(819):F(819) + len(hb)] += hb[: N - F(819)]
bk_room = reverb(bk * 0.25, 1.0, 0.7, predelay=0.008, size=0.75, hp_in=200, lp_in=8000, wid=0.8)
bk_tail = np.where(sidx < F(830), 1.0, ease_io((N - 1 - sidx) / (N - 1 - F(830))))
mix = A * maskA + B * maskB * endfade + (bk + 0.55 * bk_room) * bk_tail * maskB

# DC / rumble protection: causal 2nd-order Butterworth HP at 24 Hz
b, a = biquad_hp(24.0)
mix = iir_fft(mix, b, a)
w0_ = TWO_PI * 19000.0 / SR
al_ = np.sin(w0_) / (2 * 0.7071)
c_ = np.cos(w0_)
mix = iir_fft(mix, np.array([(1 - c_) / 2, 1 - c_, (1 - c_) / 2]) / (1 + al_), np.array([1.0, -2 * c_ / (1 + al_), (1 - al_) / (1 + al_)]))


# --------------------------------------------------------- loudness tools --
K1b = np.array([1.53512485958697, -2.69169618940638, 1.19839281085285])
K1a = np.array([1.0, -1.69065929318241, 0.73248077421585])
K2b = np.array([1.0, -2.0, 1.0])
K2a = np.array([1.0, -1.99004745483398, 0.99007225036621])


def kweight(x):
    return iir_fft(iir_fft(x, K1b, K1a), K2b, K2a)


def lufs(x):
    y = kweight(x)
    blk, hop = secs(0.4), secs(0.1)
    sq = (y ** 2).sum(0)
    cs = np.concatenate([[0.0], np.cumsum(sq)])
    starts = np.arange(0, N - blk + 1, hop)
    z = (cs[starts + blk] - cs[starts]) / blk
    lm = -0.691 + 10 * np.log10(z + 1e-20)
    g1 = lm > -70
    li0 = -0.691 + 10 * np.log10(z[g1].mean())
    g2 = g1 & (lm > li0 - 10)
    return -0.691 + 10 * np.log10(z[g2].mean()), starts, lm


def limiter(x, ceil_db=-1.4, rel=0.08, blk=48):
    ceil = dbg(ceil_db)
    m_ = x.shape[-1]
    up = np.fft.irfft(np.fft.rfft(x, axis=-1), n=m_ * 4, axis=-1) * 4
    pk = np.abs(up).reshape(2, m_, 4).max(axis=2).max(axis=0)      # inter-sample-aware peak
    del up
    req = np.minimum(1.0, ceil / np.maximum(pk, 1e-12))
    nb = N // blk
    rb = req[:nb * blk].reshape(nb, blk).min(1)
    g = np.minimum(np.minimum(rb, np.roll(rb, 1)), np.roll(rb, -1))
    g = g.tolist()
    att_step = 0.5                          # 2-block (2 ms) look-ahead ramp in log domain
    for i in range(nb - 2, -1, -1):        # backward: start ducking before the peak
        lim_v = g[i + 1] ** att_step if g[i + 1] < 1 else 1.0
        if lim_v < g[i]:
            g[i] = lim_v
    rr = np.exp(-1.0 / (rel * 1000.0))
    out = []
    v = 1.0
    for s in g:                             # forward: smooth exponential release
        v = s if s < v else min(s, rr * v + (1 - rr) * 1.0)
        out.append(v)
    gs = np.interp(np.arange(N), np.arange(nb) * blk + blk / 2, np.array(out))
    y = x * gs
    return np.clip(y, -ceil, ceil), gs


def true_peak_db(x, os_=4):
    m = x.shape[-1]
    X = np.fft.rfft(x, axis=-1)
    up = np.fft.irfft(X, n=m * os_, axis=-1) * os_
    return 20 * np.log10(np.max(np.abs(up)) + 1e-20)


# ---------------------------------------------------- master gain search --
TARGET = -15.5
silence = (sidx >= CUT_A) & (sidx < IGN)
gain_db = 0.0
ceil = -1.3
for it in range(6):
    y, gs = limiter(mix * dbg(gain_db), ceil)
    y[:, silence] = 0.0
    L, _, _ = lufs(y)
    tp = true_peak_db(y)
    print(f"  iter {it}: master gain {gain_db:+.2f} dB  -> {L:.2f} LUFS, true peak {tp:.2f} dBTP, max GR {20*np.log10(gs.min()):.1f} dB", flush=True)
    if tp > -1.05:
        ceil -= (tp + 1.05) + 0.05
    if abs(L - TARGET) < 0.15 and tp <= -1.05:
        break
    gain_db += (TARGET - L) * 1.1

gr_db = 20 * np.log10(gs)
print("  limiter GR by 30-frame block (dB):", " ".join(f"{int(f0)}:{gr_db[F(f0):F(f0+30)].min():.1f}" for f0 in range(0, 840, 30) if gr_db[F(f0):F(f0+30)].min() < -0.5))
# ------------------------------------------------------------ write WAV --
dither = (rng(99).random((2, N)) - rng(98).random((2, N))) / 32768.0
dither[:, silence] = 0.0
dither[:, F(838):] = 0.0
pcm = np.round((y + dither) * 32767.0)
pcm[:, silence] = 0.0
pcm[:, -1] = 0.0
pcm = np.clip(pcm, -32767, 32767).astype("<i2")
data = pcm.T.tobytes()
hdr = (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE" + b"fmt " +
       struct.pack("<IHHIIHH", 16, 1, 2, SR, SR * 4, 4, 16) + b"data" + struct.pack("<I", len(data)))
with open(OUT_WAV, "wb") as fh:
    fh.write(hdr + data)
print(f"  wrote {OUT_WAV} ({time.time() - T0:.1f}s)", flush=True)

# ================================================================ VERIFY ====
with open(OUT_WAV, "rb") as fh:
    raw = fh.read()
ch, sr_, = struct.unpack("<HI", raw[22:28])
bits = struct.unpack("<H", raw[34:36])[0]
dlen = struct.unpack("<I", raw[40:44])[0]
w = np.frombuffer(raw[44:44 + dlen], dtype="<i2").reshape(-1, 2).T.astype(float) / 32768.0
nsamp = w.shape[1]


def rms_db(seg):
    v = np.sqrt(np.mean(seg ** 2)) if seg.size else 0.0
    return 20 * np.log10(v) if v > 0 else -np.inf


L_int, starts, lm = lufs(w)
tp = true_peak_db(w)
peak = 20 * np.log10(np.max(np.abs(w)))
spec = json.load(open(SPEC))
print("\n==== FIRST LIGHT - audio verification ====")
print(f"file: {OUT_WAV}")
print(f"format: {sr_} Hz, {bits}-bit, {ch} ch; duration {nsamp} samples = {nsamp / SR:.6f} s (target 1344000)")
print(f"NaNs: {int(np.isnan(w).sum())}   full-scale samples (|x|>=32767): {int((np.abs(pcm) >= 32767).sum())}")
print(f"sample peak {peak:.2f} dBFS   true peak (4x) {tp:.2f} dBTP")
print(f"integrated loudness {L_int:.2f} LUFS (BS.1770 K-weighted, gated)")
print(f"DC offset L/R: {w[0].mean():.2e} / {w[1].mean():.2e}")
sil = w[:, F(580):F(600)]
print(f"hold 580-599: RMS {rms_db(sil)} dBFS, nonzero samples {int(np.count_nonzero(sil))}, max |x| {np.max(np.abs(sil))}")
print(f"active middle RMS 120-579: {rms_db(w[:, F(120):F(580)]):.1f} dBFS | 225-374: {rms_db(w[:, F(225):F(375)]):.1f} | 600-779: {rms_db(w[:, F(600):F(780)]):.1f}")
print(f"end: RMS 830-839 {rms_db(w[:, F(830):]):.1f} dBFS, last sample {w[:, -1]}")
im = int(np.argmax(lm))
print(f"loudest 400ms window starts at frame {starts[im] / SPF:.1f} ({lm[im]:.1f} LUFS momentary)")
order = np.argsort(lm)[::-1]
seen = []
for i in order:
    f0 = starts[i] / SPF
    if all(abs(f0 - s) > 30 for s in seen):
        seen.append(f0)
    if len(seen) == 5:
        break
print("top momentary windows (frame: LUFS):", ", ".join(f"{s:.0f}: {lm[int(round(s * SPF / secs(0.1)))]:.1f}" for s in seen))
print("\nper-cue RMS (2-frame windows, dBFS)")
print(f"{'frame':>5} {'type':<15} {'before':>8} {'after':>8} {'delta':>7}   {'pk bef':>7} {'pk aft':>7}")
rows = []
for c in spec["soundCues"]:
    f = c["frame"]
    bfr = rms_db(w[:, max(0, F(f - 2)):F(f)])
    aft = rms_db(w[:, F(f):F(f + 2)])
    d = aft - bfr if np.isfinite(bfr) and np.isfinite(aft) else (np.inf if np.isfinite(aft) else -np.inf)
    pb = 20 * np.log10(np.max(np.abs(w[:, max(0, F(f - 2)):F(f)])) + 1e-12) if f >= 2 else -np.inf
    pa = 20 * np.log10(np.max(np.abs(w[:, F(f):F(f + 2)])) + 1e-12)
    pb = pb if pb > -200 else -np.inf
    pa = pa if pa > -200 else -np.inf
    rows.append((f, c["type"], bfr, aft, d, pb, pa))
    print(f"{f:>5} {c['type']:<15} {bfr:>8.1f} {aft:>8.1f} {d:>7.1f}   {pb:>7.1f} {pa:>7.1f}")
for f in (294, 324, 342, 356, 366):
    seg_ = BR_STEM[F(f - 8):F(f + 8)]
    pk_f = (F(f - 8) + int(np.argmax(np.convolve(seg_, np.ones(96) / 96, mode="same")))) / SPF
    print(f"  bracket whoosh stem {f}: smoothed envelope peaks at frame {pk_f:.2f}")
    bfr = rms_db(w[:, F(f - 6):F(f - 3)])
    at = rms_db(w[:, F(f - 1):F(f + 1)])
    aft = rms_db(w[:, F(f + 3):F(f + 6)])
    print(f"  bracket pass {f}: -6..-3 {bfr:.1f} | on frame {at:.1f} | +3..+6 {aft:.1f}")

# ================================================================== PNG =====
Wd = 1680
H_CUE, H_WAV, H_GAP, H_SP = 34, 230, 8, 300
Hh = H_CUE + H_WAV + H_GAP + H_SP
img = np.zeros((Hh, Wd, 3), dtype=np.uint8)
img[:] = (14, 14, 18)
px_per_frame = Wd / NFR
# bar grid
for f in range(0, NFR, 60):
    xg = int(f * px_per_frame)
    img[H_CUE:H_CUE + H_WAV, xg] = (40, 40, 52)
# silence region tint
x0, x1 = int(580 * px_per_frame), int(600 * px_per_frame)
img[H_CUE:H_CUE + H_WAV, x0:x1] = (45, 18, 18)
# cue strip
cols = {"sub-hit": (255, 61, 31), "sub-bass hit": (255, 61, 31), "impact": (255, 120, 60), "kick": (255, 150, 90),
        "click": (200, 200, 255), "whoosh": (120, 200, 255), "riser": (255, 220, 90), "reverse swell": (190, 120, 255),
        "pad": (120, 255, 160), "tone": (255, 255, 255), "shimmer": (160, 240, 255), "silence": (255, 0, 0)}
for c in spec["soundCues"]:
    xg = min(Wd - 1, int(c["frame"] * px_per_frame))
    hgt = 6 + 5 * c["intensity"]
    img[H_CUE - hgt:H_CUE - 2, xg] = cols.get(c["type"], (180, 180, 180))
# waveform (min/max per column)
mono = 0.5 * (w[0] + w[1])
spc = N // Wd
mm = mono[:spc * Wd].reshape(Wd, spc)
mid = H_CUE + H_WAV // 2
amp = (H_WAV // 2 - 4)
for xc in range(Wd):
    lo, hi = mm[xc].min(), mm[xc].max()
    y0, y1 = int(mid - hi * amp), int(mid - lo * amp)
    img[max(H_CUE, y0):min(H_CUE + H_WAV, y1 + 1), xc] = (120, 140, 170)
# momentary loudness curve (-50..0 LUFS -> bottom..top)
for i in range(len(starts)):
    xc = int((starts[i] + secs(0.2)) / N * Wd)
    if 0 <= xc < Wd and lm[i] > -60:
        yy = int(H_CUE + H_WAV - 2 - (np.clip(lm[i], -50, 0) + 50) / 50 * (H_WAV - 4))
        img[yy:yy + 2, xc] = (255, 61, 31)
# -15 LUFS reference line
yref = int(H_CUE + H_WAV - 2 - 35 / 50 * (H_WAV - 4))
img[yref, ::4] = (255, 200, 120)
# spectrogram (log frequency 25 Hz - 20 kHz)
nfft = 4096
win = np.hanning(nfft)
padm = np.concatenate([np.zeros(nfft), mono, np.zeros(nfft)])
cent = (np.arange(Wd) * spc + spc // 2 + nfft).astype(int)
idx = cent[:, None] + np.arange(-nfft // 2, nfft // 2)[None, :]
Sx = np.abs(np.fft.rfft(padm[idx] * win, axis=1)) / (win.sum() / 2)
sdb = 20 * np.log10(Sx + 1e-12)
freqs = np.fft.rfftfreq(nfft, 1 / SR)
rows_f = 25.0 * (20000.0 / 25.0) ** (1 - np.arange(H_SP) / (H_SP - 1))
bins = np.clip(np.searchsorted(freqs, rows_f), 1, len(freqs) - 1)
val = np.clip((sdb[:, bins].T + 110) / 90.0, 0, 1)
stops = np.array([[0, 0, 4], [59, 15, 112], [140, 41, 129], [222, 73, 104], [254, 159, 109], [252, 253, 191]], float)
pos = np.linspace(0, 1, len(stops))
rgb = np.stack([np.interp(val, pos, stops[:, k]) for k in range(3)], -1).astype(np.uint8)
img[H_CUE + H_WAV + H_GAP:, :] = rgb
for f in range(0, NFR, 60):
    img[H_CUE + H_WAV + H_GAP:H_CUE + H_WAV + H_GAP + 6, int(f * px_per_frame)] = (255, 255, 255)


def png_write(path, im_):
    h, w_, _ = im_.shape
    rawb = b"".join(b"\x00" + im_[yy].tobytes() for yy in range(h))

    def chunk(tag, d):
        return struct.pack(">I", len(d)) + tag + d + struct.pack(">I", zlib.crc32(tag + d) & 0xFFFFFFFF)

    with open(path, "wb") as fh_:
        fh_.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w_, h, 8, 2, 0, 0, 0)) +
                  chunk(b"IDAT", zlib.compress(rawb, 6)) + chunk(b"IEND", b""))


png_write(OUT_PNG, img)
print(f"\nwrote {OUT_PNG}; total {time.time() - T0:.1f}s")
