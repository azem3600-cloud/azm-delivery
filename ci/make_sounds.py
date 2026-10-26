#!/usr/bin/env python3
"""توليد أصوات التنبيه — صوت "صرّافة" (كاشير: كا-تشينغ) عالي وواضح، بدون مكتبات خارجية.
order.wav  : لوحة التحكم / الكاشير — كا-تشينغ مرتين
driver.wav : جوال المندوب — كا-تشينغ ثلاث مرات أسرع مع جرس أعلى (مميز)
"""
import math, os, random, struct, sys, wave

SR = 44100
OUT = sys.argv[1] if len(sys.argv) > 1 else "web/sounds"
random.seed(7)


def add(buf, i0, sig):
    for k, v in enumerate(sig):
        if 0 <= i0 + k < len(buf):
            buf[i0 + k] += v


def noise_burst(dur, decay, hp=0.85, amp=1.0):
    """نقرة ميكانيكية (درج الصرّافة) — ضوضاء مفلترة بتلاشي سريع"""
    n = int(dur * SR); out = []; prev_x = prev_y = 0.0
    for k in range(n):
        x = random.uniform(-1, 1)
        y = hp * (prev_y + x - prev_x)          # فلتر تمرير عالي بسيط
        prev_x, prev_y = x, y
        out.append(amp * y * math.exp(-(k / SR) / decay))
    return out


def bell(f, dur, amp=1.0):
    """جرس معدني (نسب ترددات غير متناسقة مثل جرس الكاشير)"""
    partials = ((1.0, 1.0, 0.9), (2.76, 0.55, 0.45), (5.40, 0.35, 0.25), (8.93, 0.22, 0.15), (1.5, 0.25, 0.6))
    n = int(dur * SR); out = []
    for k in range(n):
        t = k / SR; att = min(1.0, t / 0.002); s = 0.0
        for r, a, d in partials:
            s += a * math.sin(2 * math.pi * f * r * t) * math.exp(-t / d)
        out.append(amp * att * s)
    return out


def coins(dur, amp=0.35):
    """رنين عملات خفيف بعد الجرس"""
    n = int(dur * SR); out = [0.0] * n
    for _ in range(9):
        at = random.randint(0, int(n * 0.7)); f = random.uniform(3500, 6500)
        for k in range(int(0.04 * SR)):
            if at + k < n:
                t = k / SR
                out[at + k] += amp * math.sin(2 * math.pi * f * t) * math.exp(-t / 0.012)
    return out


def ka_ching(buf, at, bell_f=2350, scale=1.0):
    i = int(at * SR)
    add(buf, i, noise_burst(0.06, 0.018, amp=0.9 * scale))                 # "كا" — نقرة
    add(buf, i + int(0.045 * SR), noise_burst(0.05, 0.012, amp=0.6 * scale))
    add(buf, i + int(0.09 * SR), bell(bell_f, 1.1, amp=1.0 * scale))       # "تشينغ" — جرس
    add(buf, i + int(0.10 * SR), bell(bell_f * 1.26, 0.9, amp=0.45 * scale))
    add(buf, i + int(0.12 * SR), coins(0.5))                               # عملات


def write(buf, path):
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
    ka_ching(b, j * 0.75, bell_f=2800)
write(b, os.path.join(OUT, "driver.wav"))
print("sounds ->", OUT)
