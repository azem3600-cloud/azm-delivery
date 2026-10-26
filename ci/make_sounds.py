#!/usr/bin/env python3
"""توليد أصوات التنبيه (بدون مكتبات خارجية) — عالية وواضحة.
order.wav  : لوحة التحكم / الكاشير — رنين ثلاثي مشرق ×2
driver.wav : جوال المندوب — نغمة مميزة سريعة متكررة مع صفّارة صاعدة
"""
import math, os, struct, sys, wave

SR = 44100
OUT = sys.argv[1] if len(sys.argv) > 1 else "web/sounds"


def tone(buf, at, f, dur, harm=((1, 1.0), (2, 0.45), (3, 0.25), (4, 0.12)), decay=None):
    n = int(dur * SR); i0 = int(at * SR); tau = decay or dur / 4
    for k in range(n):
        if i0 + k >= len(buf): break
        t = k / SR
        e = min(1.0, t / 0.005) * math.exp(-t / tau)
        s = 0.0
        for h, a in harm:
            s += a * math.sin(2 * math.pi * f * h * t)
        buf[i0 + k] += s * e


def sweep(buf, at, f0, f1, dur, amp=0.8):
    n = int(dur * SR); i0 = int(at * SR); ph = 0.0
    for k in range(n):
        if i0 + k >= len(buf): break
        t = k / SR
        ph += 2 * math.pi * (f0 + (f1 - f0) * t / dur) / SR
        buf[i0 + k] += amp * math.sin(ph) * min(1.0, t / 0.01) * math.exp(-t / 0.25)


def write(buf, path):
    peak = max(abs(x) for x in buf) or 1.0
    out = [math.tanh(x / peak * 2.2) for x in buf]          # ضغط لرفع الإحساس بالعلو
    peak = max(abs(x) for x in out) or 1.0
    data = b"".join(struct.pack("<h", int(x / peak * 0.94 * 32767)) for x in out)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data)


os.makedirs(OUT, exist_ok=True)

b = [0.0] * int(3.6 * SR)
for rep in range(2):
    for i, f in enumerate([1046.5, 1318.5, 1568.0]):
        tone(b, rep * 1.4 + i * 0.16, f, 0.9, decay=0.28)
tone(b, 2.8, 2093.0, 0.8, decay=0.35)
write(b, os.path.join(OUT, "order.wav"))

b = [0.0] * int(3.0 * SR)
for rep in range(3):
    t0 = rep * 1.0
    for j, f in enumerate([1480, 1975, 1480, 1975]):
        tone(b, t0 + j * 0.14, f, 0.13, harm=((1, 1.0), (3, 0.3), (5, 0.15)), decay=0.08)
    sweep(b, t0 + 0.6, 900, 3100, 0.35)
write(b, os.path.join(OUT, "driver.wav"))
print("sounds ->", OUT)
