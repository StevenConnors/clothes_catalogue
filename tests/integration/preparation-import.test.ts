import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { importBatch } from '../../scripts/import-batch';
import type { WardrobeDocument, WardrobeRepository, ImageStore } from '../../src/lib/contracts/persistence';

describe('Python transform outputs carried through TypeScript import',()=>{
 it('preserves original bytes and imports only approved fixtures; dry-run performs zero writes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'wardrobe-cross-'));
  const rows:WardrobeDocument[]=[]; const blobs=new Map<string,Uint8Array>();
  const repository:WardrobeRepository={
   async listActive(type){return rows.filter(r=>!r.deletedAt&&(!type||r.type===type));},
   async countActiveByType(){const counts={outer:0,shirt:0,tshirt:0,pants:0,shorts:0,shoes:0};for(const r of rows)if(!r.deletedAt)counts[r.type]++;return counts;},
   async getActiveById(id){return rows.find(r=>r._id===id&&!r.deletedAt)||null;},
   async findBySourceHash(hash){return rows.find(r=>r.sourceSha256===hash)||null;},
   async insertIfAbsent(document){const existing=rows.find(r=>r.sourceSha256===document.sourceSha256);if(existing)return{inserted:false,document:existing};rows.push(document);return{inserted:true,document};},
   async updateType(id,type){const r=rows.find(r=>r._id===id&&!r.deletedAt);if(r)r.type=type;return r||null;},
   async softDelete(id){const r=rows.find(r=>r._id===id);if(r)r.deletedAt=new Date();return Boolean(r);},
  };
  const imageStore:ImageStore={async putPrivate(pathname,bytes,contentType){blobs.set(pathname,bytes);return{pathname,contentType};},async readPrivate(){return null;}};
  try {
   execFileSync(process.env.WARDROBE_TEST_PYTHON||'python3',['-c',`
import sys,importlib.util,json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw
spec=importlib.util.spec_from_file_location('prepare',sys.argv[2]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
root=Path(sys.argv[1]);incoming=root/'wardrobe-data/incoming/fixture';output=root/'wardrobe-data/processed/fixture';incoming.mkdir(parents=True);output.mkdir(parents=True)
entries=[]
for i in range(3):
 photo=Image.new('RGB',(200,120),(230,230,230));draw=ImageDraw.Draw(photo);draw.rectangle((30,20,70,100),fill=(40+i,60,100));draw.rectangle((130,20,170,100),fill=(40+i,60,100))
 source=incoming/f'{i}.png';photo.save(source);mask=Image.new('L',photo.size,0);md=ImageDraw.Draw(mask);md.rectangle((30,20,70,100),fill=255);md.rectangle((130,20,170,100),fill=255)
 cutout,warnings=module.transform(photo,mask);target=output/f'{i}.png';cutout.save(target)
 digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
 entries.append(dict(sourcePath=source.name,sourceSha256=digest(source),type='shoes',cutoutPath=target.name,cutoutSha256=digest(target),model='birefnet-general',warnings=warnings,reviewStatus='approved' if i<2 else 'pending'))
module.atomic_json(output/'manifest.json',dict(schemaVersion=1,batchId='fixture',entries=entries))
`,root,resolve('scripts/prepare-batch.py')]);
   const dry=await importBatch({root,batch:'fixture',dryRun:true},{repository,imageStore});
   expect(dry.planned).toHaveLength(2);expect(dry.report.imported).toHaveLength(0);expect(rows).toHaveLength(0);expect(blobs.size).toBe(0);
   const live=await importBatch({root,batch:'fixture'},{repository,imageStore});expect(live.report.imported).toHaveLength(2);expect(blobs.size).toBe(4);
   const original=await readFile(join(root,'wardrobe-data/incoming/fixture/0.png'));expect(Buffer.from(blobs.get(rows[0].images.original.pathname)!)).toEqual(original);
   await repository.updateType(rows[0]._id,'outer');await repository.softDelete(rows[1]._id);
   const retry=await importBatch({root,batch:'fixture'},{repository,imageStore});expect(retry.report.imported).toHaveLength(0);expect(retry.report.skipped.map(s=>s.reason)).toEqual(['already_exists','previously_removed','not_approved']);expect(rows[0].type).toBe('outer');expect(rows).toHaveLength(2);expect(blobs.size).toBe(4);
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
