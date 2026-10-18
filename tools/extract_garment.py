"""
Test of "option 3": cut the garment out of a photo of a person wearing it.

Usage:  python3 -I extract_garment.py <photo> <output folder>

It uses rembg's u2net_cloth_seg model, which labels each pixel as background, upper-body clothes,
lower-body clothes or full-body clothes. For every label that covers a meaningful part of the photo it saves

    <name>_<label>.png       the garment alone, transparent background, cropped, at most 640 px (the size the calculator keeps)

and one contact sheet, <name>_sheet.png: the original photo, then each cut-out on a checkerboard.
It also prints, for each cut-out, what share of the photo it covers and its height/width, which is what the
calculator's safety check looks at.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from rembg import new_session

LABELS = ['upper body', 'lower body', 'full body']
MAX_SIDE = 640


def checker(size, cell=14):
    w, h = size
    bg = Image.new('RGB', size, (235, 235, 235))
    d = ImageDraw.Draw(bg)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if (x // cell + y // cell) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(205, 205, 205))
    return bg


def main(photo, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    name = os.path.splitext(os.path.basename(photo))[0]
    img = Image.open(photo).convert('RGB')
    img.thumbnail((1400, 1400))
    session = new_session('u2net_cloth_seg')
    masks = session.predict(img)                      # three L-mode masks, 255 where that label is
    total = img.width * img.height
    tiles = [('photo', img.copy())]
    print(f'{name}: photo {img.width}x{img.height}')
    for label, mask in zip(LABELS, masks):
        m = np.asarray(mask.convert('L')) > 127
        share = m.mean()
        if share < 0.01:
            print(f'  {label:11s}: nothing found ({share * 100:.1f}% of the photo)')
            continue
        ys, xs = np.where(m)
        box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
        rgba = np.dstack([np.asarray(img), (m * 255).astype('uint8')])
        cut = Image.fromarray(rgba, 'RGBA').crop(box)
        cut.thumbnail((MAX_SIDE, MAX_SIDE))
        fill = m[box[1]:box[3], box[0]:box[2]].mean()
        path = os.path.join(out_dir, f'{name}_{label.replace(" ", "_")}.png')
        cut.save(path)
        print(f'  {label:11s}: {share * 100:4.1f}% of the photo, box {box[2] - box[0]}x{box[3] - box[1]} px '
              f'(height/width {(box[3] - box[1]) / (box[2] - box[0]):.2f}), garment fills {fill * 100:.0f}% of its box -> {path}')
        tiles.append((label, cut))
    # contact sheet
    H = 520
    scaled = []
    for label, im in tiles:
        r = H / im.height
        t = im.resize((max(1, int(im.width * r)), H))
        if im.mode == 'RGBA':
            base = checker(t.size)
            base.paste(t, mask=t.split()[3])
            t = base
        scaled.append((label, t))
    sheet = Image.new('RGB', (sum(t.width for _, t in scaled) + 12 * (len(scaled) + 1), H + 40), (30, 33, 40))
    d = ImageDraw.Draw(sheet)
    x = 12
    for label, t in scaled:
        sheet.paste(t, (x, 28))
        d.text((x, 8), label, fill=(240, 240, 240))
        x += t.width + 12
    sheet_path = os.path.join(out_dir, f'{name}_sheet.png')
    sheet.save(sheet_path)
    print('  sheet ->', sheet_path)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
