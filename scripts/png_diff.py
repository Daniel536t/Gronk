#!/usr/bin/env python3
"""Pixel difference between two PNGs, stdlib only.

Reports the fraction of pixels differing by more than a threshold in any
channel, and the mean absolute difference. Used to prove that a DEPLOYED build
is actually animating and that a camera control actually changed the frame --
claims that cannot be made from source inspection.
"""
import struct, sys, zlib

def load(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', path + ': not a PNG'
    pos, idat, meta = 8, bytearray(), None
    while pos < len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', body)
            assert depth == 8 and interlace == 0, path + ': unsupported PNG'
            meta = (w, h, {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color])
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
        pos += 12 + ln
    w, h, ch = meta
    raw = zlib.decompress(bytes(idat))
    stride, out, prev = w * ch, bytearray(), bytearray(w * ch)
    p = 0
    for _ in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        for i in range(stride):
            a = line[i - ch] if i >= ch else 0
            b = prev[i]
            c = prev[i - ch] if i >= ch else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + ((a + b) >> 1)) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out += line; prev = line
    return w, h, ch, out

def main():
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    flags = [x for x in sys.argv[1:] if x.startswith('--')]
    a, b = args[0], args[1]
    thresh = int(args[2]) if len(args) > 2 else 8
    # --rect=x,y,w,h restricts the comparison to one region, which is how a whole
    # frame diff gets turned into an ANSWER: the ocean region proves the world is
    # animating, while the HUD readout region proves the numbers did not move.
    rect = None
    label = 'whole frame'
    for f in flags:
        if f.startswith('--rect='):
            rect = tuple(int(v) for v in f.split('=', 1)[1].split(','))
            label = 'rect=%d,%d %dx%d' % rect
    wa, ha, ca, da = load(a)
    wb, hb, cb, db = load(b)
    if (wa, ha) != (wb, hb):
        print('SIZE_MISMATCH %dx%d vs %dx%d' % (wa, ha, wb, hb)); return 2
    if rect is None:
        rect = (0, 0, wa, ha)
    rx, ry, rw, rh = rect
    rx, ry = max(0, rx), max(0, ry)
    rw, rh = min(rw, wa - rx), min(rh, ha - ry)
    if rw <= 0 or rh <= 0:
        print('EMPTY_RECT'); return 2
    changed, total, n = 0, 0, rw * rh
    step = min(ca, cb)
    for y in range(ry, ry + rh):
        rowa, rowb = y * wa * ca, y * wb * cb
        for x in range(rx, rx + rw):
            pa, pb = rowa + x * ca, rowb + x * cb
            d = max(abs(da[pa + k] - db[pb + k]) for k in range(min(3, step)))
            total += d
            if d > thresh: changed += 1
    print('%s pixels=%d changed=%.3f%% mean_abs_diff=%.2f' % (label, n, 100.0 * changed / n, total / n))
    return 0

sys.exit(main())
