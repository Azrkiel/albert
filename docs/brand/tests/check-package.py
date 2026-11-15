"""Static package checks; no browser or third-party Python dependencies required."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import unquote
import json,re

ROOT=Path(__file__).resolve().parents[1]
errors=[]
class Page(HTMLParser):
 def __init__(self):
  super().__init__();self.ids={};self.links=[];self.references=[];self.image_count=0
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if a.get('id'):
   if a['id'] in self.ids:errors.append('Duplicate HTML id: '+a['id'])
   self.ids[a['id']]=a
  for key in ['aria-controls','aria-describedby','aria-labelledby']:
   if a.get(key):self.references.extend(a[key].split())
  if tag=='label' and a.get('for'):self.references.append(a['for'])
  if tag=='img':
   self.image_count+=1
   if 'alt' not in a:errors.append('Image missing alt attribute: '+str(a.get('src')))
  for key in ['href','src']:
   if a.get(key):self.links.append(a[key])

index=ROOT/'reference/index.html';page=Page();page.feed(index.read_text())
for ref in page.references:
 if ref not in page.ids:errors.append('Missing HTML association: '+ref)
for link in page.links:
 if link.startswith(('https:','http:','data:','mailto:')):continue
 if link.startswith('#'):
  if link[1:] not in page.ids:errors.append('Missing fragment target: '+link)
 elif not (index.parent/unquote(link.split('#')[0])).is_file():errors.append('Missing local HTML asset: '+link)
extra_pages=0
for file in ROOT.rglob('*.html'):
 if file==index:continue
 other=Page();other.feed(file.read_text());extra_pages+=1
 for ref in other.references:
  if ref not in other.ids:errors.append(f'{file.name}: missing HTML association {ref}')
 for link in other.links:
  if '{{' in link or link.startswith(('https:','http:','data:','mailto:')):continue
  if link.startswith('#'):
   if link[1:] not in other.ids:errors.append(f'{file.name}: missing fragment {link}')
  elif not (file.parent/unquote(link.split('#')[0].split('?')[0])).is_file():errors.append(f'{file.name}: missing local asset {link}')
for p in ROOT.rglob('*.md'):
 for link in re.findall(r'\]\(([^)]+)\)',p.read_text()):
  if link.startswith(('http:','https:','mailto:','#')):continue
  if not (p.parent/unquote(link.split('#')[0])).is_file():errors.append(f'{p.name}: missing {link}')
styles=list(ROOT.rglob('*.css'))
css='\n'.join(p.read_text() for p in styles)
used=set(re.findall(r'var\((--[a-z0-9-]+)',css))
defined=set(re.findall(r'(--[a-z0-9-]+)\s*:',css))
if used-defined:errors.append('Undefined CSS variables: '+str(used-defined))
for p in styles:
 for source in re.findall(r'url\([\'"]?([^\)\'\"]+)',p.read_text()):
  if not source.startswith(('data:','https:','http:')) and not (p.parent/source).is_file():errors.append('Missing CSS resource: '+source)
for p in ROOT.rglob('*.json'):json.loads(p.read_text())
for ref in re.findall(r"\$\(['\"]#([a-zA-Z0-9_-]+)", (ROOT/'reference/app.js').read_text()):
 if ref not in page.ids:errors.append('JavaScript references missing id: '+ref)
tabs=[a for a in page.ids.values() if a.get('role')=='tab']
if sum(a.get('aria-selected')=='true' for a in tabs)!=1:errors.append('Expected one initially selected course tab')
for name in ['OFL-Fraunces.txt','OFL-PlusJakartaSans.txt']:
 if 'SIL OPEN FONT LICENSE' not in (ROOT/'assets/fonts'/name).read_text():errors.append('Missing OFL notice: '+name)
if errors:raise SystemExit('\n'.join(errors))
print(f'Passed: {extra_pages+1} HTML pages; {len(page.ids)} reference ids; label/ARIA associations; image alt attributes; local references; {len(used)} CSS variables; JSON; and OFL notices.')
