"""把书里用的图片缩成 1400 像素高的小尺寸版本，放进 images/web/。

原图（images/cover.jpg、images/pages/*.jpg）保留不动；
网页里用小图，iPad 等设备显存吃得少，翻书不会闪。

用法：在项目根目录运行
    python tools/make-web-images.py
"""
import glob
import os

from PIL import Image

HEIGHT = 1400
OUT = 'images/web'

os.makedirs(OUT, exist_ok=True)
for src in ['images/cover.jpg'] + sorted(glob.glob('images/pages/*.jpg')):
    im = Image.open(src).convert('RGB')
    width = round(im.width * HEIGHT / im.height)
    dst = os.path.join(OUT, os.path.basename(src))
    im.resize((width, HEIGHT), Image.LANCZOS).save(dst, quality=86, optimize=True, progressive=True)
    print(src, '->', dst)
