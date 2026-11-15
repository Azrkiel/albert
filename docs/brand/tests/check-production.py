"""Production export checks. Requires Pillow and NumPy for image inspection."""
from pathlib import Path
import xml.etree.ElementTree as ET
import json
import numpy as np
from PIL import Image

R=Path(__file__).resolve().parents[1]
NS={'s':'http://www.w3.org/2000/svg'}
svgs=list((R/'assets/logos/vector').glob('*.svg'))
assert len(svgs)==9
for p in svgs:
 root=ET.parse(p).getroot()
 assert root.findall('.//s:path',NS),p
 assert not root.findall('.//s:image',NS),p
 assert not root.findall('.//s:text',NS),p
 assert root.attrib.get('viewBox'),p
for size in [128,256,512,1024]:
 files=list((R/f'assets/mascot/normalized/{size}').glob('*.png'))
 assert len(files)==8
 for p in files:
  im=Image.open(p);a=np.array(im.getchannel('A'))
  assert im.size==(size,size) and a.min()==0 and a.max()>128,p
  ys,xs=np.where(a>128)
  assert abs((ys.max()+1)-size*924/1024)<=2,(p,ys.max()+1)
  assert xs.min()>0 and xs.max()<size-1,p
for name,size in [('favicon-16.png',16),('favicon-32.png',32),('favicon-48.png',48),('apple-touch-icon.png',180),('icon-192.png',192),('icon-512.png',512),('icon-maskable-192.png',192),('icon-maskable-512.png',512)]:
 assert Image.open(R/'assets/icons'/name).size==(size,size),name
assert Image.open(R/'assets/icons/favicon.ico').info['sizes']=={(16,16),(32,32),(48,48)}
for size in [192,512]:
 a=np.array(Image.open(R/f'assets/icons/icon-maskable-{size}.png').convert('RGB')).astype(float)
 foreground=np.max(np.abs(a-np.array([250,247,240])),axis=2)>80
 y,x=np.where(foreground);dist=np.hypot(x-(size-1)/2,y-(size-1)/2)
 assert dist.max()<=size*.4,(size,dist.max())
assert Image.open(R/'assets/social/albert-og-1200x630.png').size==(1200,630)
assert Image.open(R/'assets/social/albert-square-1080.png').size==(1080,1080)
motion=Image.open(R/'assets/mascot/motion/guiding-to-waiting.webp')
assert motion.n_frames==6 and motion.info['loop']==1
assert Image.open(R/'assets/mascot/normalized/pose-sheet-512.png').size==(4096,512)
for name in ['welcome','account-recovery','import-complete','support-response']:
 assert (R/f'templates/emails/{name}.html').is_file()
 assert (R/f'templates/emails/{name}.txt').is_file()
 assert '{{' not in (R/f'templates/emails/previews/{name}.html').read_text(),name
manifest=json.loads((R/'assets/icons/site.webmanifest').read_text())
for icon in manifest['icons']:assert (R/'assets/icons'/icon['src']).is_file()
print('Passed: 9 path-only SVGs; 32 aligned transparent pose exports; icon dimensions and maskable safe area; ICO sizes; social dimensions; six-frame one-shot motion; sprite geometry; and four email template sets.')
