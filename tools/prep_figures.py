# -*- coding: utf-8 -*-
"""从 PDF 原页裁出综合分析题 4 张插图，转成干净的黑白线稿。

用法：
    python tools/prep_figures.py --src .figurework --out assets/mech

输入是 400dpi 的整页 PNG（page0060/0061/0062.png），裁切框按 PDF 点坐标
（1pt = 400/72 px）给出，裁完自动去白边并二值化。
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import png_util as P

DPI = 400
SCALE = DPI / 72.0

# (源文件, PDF 页内裁切框 left/top/right/bottom 单位 pt, 输出名, 闭运算半径)
CROPS = [
    ("page0060.png", (60, 121, 482, 392), "q1-fe-c-regions.png", 0),
    ("page0060.png", (64, 634, 259, 802), "q2-fe-c-points.png", 2),
    ("page0061.png", (62, 96, 306, 292), "q3-cct-cooling.png", 0),
    ("page0062.png", (66, 94, 316, 320), "q4-cct-cooling.png", 0),
]


def pt_box_to_px(box):
    l, t, r, b = box
    return (int(l * SCALE), int(t * SCALE), int(r * SCALE), int(b * SCALE))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=".figurework")
    ap.add_argument("--out", default="assets/mech")
    ap.add_argument("--ink", type=int, default=150)
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    cache = {}
    for src, box, name, close_r in CROPS:
        path = os.path.join(args.src, src)
        if path not in cache:
            print("loading", src, "...")
            cache[path] = P.read_png(path)
        img = cache[path]
        piece = P.crop(img, pt_box_to_px(box))
        piece = P.binarize(piece, ink=args.ink)
        if close_r:
            piece = P.close(piece, close_r)
        piece = P.tight_bbox(piece, margin=10)
        dst = os.path.join(args.out, name)
        P.write_png(dst, piece)
        print("wrote %-24s %dx%d  %.1f KB" % (name, piece.w, piece.h,
                                              os.path.getsize(dst) / 1024.0))


if __name__ == "__main__":
    main()
