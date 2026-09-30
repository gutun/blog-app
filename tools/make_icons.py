"""生成 PWA 图标（192 / 512 / apple-touch-icon）。

与 public/favicon.svg 同一套视觉：圆角方块 + 文档 + 三行文字。
用法：python tools/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parent.parent / "public"

ACCENT = (91, 186, 213, 255)
PAPER = (255, 255, 255, 250)
FOLD = (207, 238, 247, 255)
INK = (43, 107, 125, 255)

# 以 1024 为基准绘制，再缩放到目标尺寸，边缘更平滑
BASE = 1024
SCALE = BASE / 64.0


def s(value: float) -> int:
    return int(round(value * SCALE))


def build_base() -> Image.Image:
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 背景圆角方块
    draw.rounded_rectangle([0, 0, BASE - 1, BASE - 1], radius=s(14), fill=ACCENT)

    # 纸张
    draw.rounded_rectangle([s(16), s(12), s(48), s(52)], radius=s(4), fill=PAPER)

    # 右上角折角
    draw.polygon([(s(38), s(12)), (s(48), s(22)), (s(38), s(22))], fill=FOLD)

    # 三行文字
    for top, width in ((30, 20), (37, 20), (44, 12)):
        draw.rounded_rectangle(
            [s(22), s(top), s(22 + width), s(top + 3)],
            radius=s(1.5),
            fill=INK,
        )
    return img


def main() -> None:
    base = build_base()
    outputs = {
        "pwa-192x192.png": 192,
        "pwa-512x512.png": 512,
        "apple-touch-icon.png": 180,
        "favicon-32x32.png": 32,
    }
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for name, size in outputs.items():
        icon = base.resize((size, size), Image.LANCZOS)
        path = PUBLIC / name
        icon.save(path, format="PNG", optimize=True)
        print(f"{path.name}: {size}x{size}, {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
