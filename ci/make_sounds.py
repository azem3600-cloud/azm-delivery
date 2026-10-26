#!/usr/bin/env python3
"""توليد أصوات التنبيه — صوت "صرّافة" (كاشير: كا-تشينغ) عالي وواضح، بدون مكتبات خارجية.
order.wav  : لوحة التحكم / الكاشير — كا-تشينغ مرتين
driver.wav : جوال المندوب — كا-تشينغ ثلاث مرات متتالية (مميز)
"""
import math, os, random, struct, sys, wave

SR = 44100
OUT = sys.argv[1] if len(sys.argv) > 1 else "web/sounds"
random.seed(7)


def add(buf, i0, sig):
    for k, v in enumerate(sig):
        if 0 <= i0 + k < len(buf):
            buf[i0 + k] += v


def lowpass(sig, fc):
    a = math.exp(-2 * math.pi * fc / SR); y = 0.0; out = []
    for x in sig:
        y = (1 - a) * x + a * y; out.append(y)
    return out


def thunk(dur=0.07, amp=1.0):
    """"كا" — صوت درج الصرّافة: ضربة خشنة منخفضة بدون صفير"""
    n = int(dur * SR)
    noise = lowpass([random.uniform(-1, 1) for _ in range(n)], 1400)
    out = []
    for k in range(n):
        t = k / SR
        body = math.sin(2 * math.pi * 170 * t) * math.exp(-t / 0.03)
        out.append(amp * (2.2 * noise[k] * math.exp(-t / 0.015) + 0.8 * body))
    return out


def bell(f, dur, amp=1.0):
    """"تشينغ" — جرس دافئ (توافقيات قليلة ومنخفضة — بدون صفير حاد)"""
    partials = ((1.0, 1.0, 0.55), (2.0, 0.28, 0.30), (2.76, 0.12, 0.18))
    n = int(dur * SR); out = []
    for k in range(n):
        t = k / SR; att = min(1.0, t / 0.004); s = 0.0
        for r, a, d in partials:
            s += a * math.sin(2 * math.pi * f * r * t) * math.exp(-t / d)
        out.append(amp * att * s)
    return out


def ka_ching(buf, at, bell_f=1320, scale=1.0):
    i = int(at * SR)
    add(buf, i, thunk(amp=0.9 * scale))
    add(buf, i + int(0.06 * SR), thunk(0.05, amp=0.5 * scale))
    add(buf, i + int(0.11 * SR), bell(bell_f, 1.0, amp=1.0 * scale))
    add(buf, i + int(0.13 * SR), bell(bell_f * 1.25, 0.8, amp=0.5 * scale))


def write(buf, path):
    buf = lowpass(buf, 4500)                                   # إزالة أي حدة/صفير
    peak = max(abs(x) for x in buf) or 1.0
    out = [math.tanh(x / peak * 1.8) for x in buf]          # ضغط لرفع العلو
    peak = max(abs(x) for x in out) or 1.0
    data = b"".join(struct.pack("<h", int(x / peak * 0.95 * 32767)) for x in out)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data)


os.makedirs(OUT, exist_ok=True)

b = [0.0] * int(2.6 * SR)
ka_ching(b, 0.0)
ka_ching(b, 1.15)
write(b, os.path.join(OUT, "order.wav"))

b = [0.0] * int(2.7 * SR)
for j in range(3):
    ka_ching(b, j * 0.75, bell_f=1480)
write(b, os.path.join(OUT, "driver.wav"))
print("sounds ->", OUT)
