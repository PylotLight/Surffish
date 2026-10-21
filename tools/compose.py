import json, sys, glob, os
from PIL import Image
out = sys.argv[1]
for meta in sorted(glob.glob(os.path.join(out, '*.json'))):
    d = json.load(open(meta))
    canvas = Image.new('RGBA', (d['width'], d['height']), (20, 20, 22, 255))
    for p in d['parts']:
        im = Image.open(p['file']).convert('RGBA')
        if im.size != (p['width'], p['height']):
            im = im.resize((p['width'], p['height']))
        canvas.alpha_composite(im, (p['x'], p['y']))
    target = meta[:-5] + '.png'
    canvas.convert('RGB').save(target)
    for p in d['parts']:
        os.remove(p['file'])
    os.remove(meta)
    print(target, canvas.size)
