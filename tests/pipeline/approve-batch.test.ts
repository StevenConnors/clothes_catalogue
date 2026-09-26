import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { approveBatch } from '../../scripts/approve-batch';
import type { BatchManifest } from '../../src/lib/contracts/batch';
const roots: string[] = [];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wardrobe-approve-')); roots.push(root);
  const processed = path.join(root, 'wardrobe-data/processed/demo');
  const incoming = path.join(root, 'wardrobe-data/incoming/demo');
  await fs.mkdir(processed, { recursive: true }); await fs.mkdir(incoming, { recursive: true });
  const cutout = await sharp({create:{width:8,height:8,channels:4,background:{r:10,g:20,b:30,alpha:1}}}).png().toBuffer();
  const manifest: BatchManifest = {schemaVersion:1,batchId:'demo',entries:[]};
  for (let n=1;n<=3;n++) {
    const source = await sharp({create:{width:8,height:8,channels:3,background:{r:n*60,g:20,b:30}}}).jpeg().toBuffer();
    await fs.writeFile(path.join(incoming, `${n}.jpg`), source);
    await fs.writeFile(path.join(processed, `${n}.png`), cutout);
    manifest.entries.push({sourcePath:`${n}.jpg`,sourceSha256:hash(source),cutoutPath:`${n}.png`,cutoutSha256:hash(cutout),type:'pants',model:'birefnet-general',warnings:[],reviewStatus:'pending'});
  }
  const manifestPath=path.join(processed,'manifest.json');
  const save=()=>fs.writeFile(manifestPath,JSON.stringify(manifest));
  await save();
  await fs.writeFile(path.join(processed,'review-index.json'),JSON.stringify({batchId:'demo',entries:manifest.entries.map((e,i)=>({number:i+1,sourceSha256:e.sourceSha256,cutoutSha256:e.cutoutSha256}))}));
  return {root,processed,incoming,manifest,manifestPath,save,options:{root,batch:'demo'}};
}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
describe('approveBatch',()=>{
  it('approves selected numbered ranges and preserves other fields; repeat is idempotent',async()=>{
    const f=await fixture();const result=await approveBatch({...f.options,items:'1,3-3'});
    expect(result.selected).toEqual([1,3]);expect(result.changed).toBe(2);
    const saved=JSON.parse(await fs.readFile(f.manifestPath,'utf8'));
    expect(saved.entries.map((e:{reviewStatus:string})=>e.reviewStatus)).toEqual(['approved','pending','approved']);
    expect(saved.entries[0]).toEqual({...f.manifest.entries[0],reviewStatus:'approved'});
    const before=await fs.readFile(f.manifestPath);
    expect((await approveBatch({...f.options,items:'1,3'})).changed).toBe(0);
    expect(await fs.readFile(f.manifestPath)).toEqual(before);
  });
  it('supports whole batch with exclusions and dry-run without modifying the manifest',async()=>{
    const f=await fixture();const before=await fs.readFile(f.manifestPath);
    expect((await approveBatch({...f.options,all:true,except:'2',dryRun:true})).selected).toEqual([1,3]);
    expect(await fs.readFile(f.manifestPath)).toEqual(before);
    expect((await approveBatch({...f.options,all:true,except:'2'})).changed).toBe(2);
  });
  it('requires explicit acceptance of warnings and never approves rejected entries',async()=>{
    const f=await fixture();f.manifest.entries[0].warnings=['Hanger visible'];f.manifest.entries[1].reviewStatus='rejected';await f.save();
    const before=await fs.readFile(f.manifestPath);
    await expect(approveBatch({...f.options,items:'1'})).rejects.toThrow('--accept-warnings');
    await expect(approveBatch({...f.options,all:true,acceptWarnings:true})).rejects.toThrow('#2: Entry is rejected');
    expect(await fs.readFile(f.manifestPath)).toEqual(before);
    expect((await approveBatch({...f.options,all:true,except:'2',acceptWarnings:true})).changed).toBe(2);
  });
  it('fails the entire selection for an unclassified item',async()=>{
    const f=await fixture();f.manifest.entries[2].type=null;await f.save();const before=await fs.readFile(f.manifestPath);
    await expect(approveBatch({...f.options,all:true})).rejects.toThrow('#3: entry requires');
    expect(await fs.readFile(f.manifestPath)).toEqual(before);
  });
  it('rejects changed cutout bytes and stale review mappings',async()=>{
    const f=await fixture();const before=await fs.readFile(f.manifestPath);
    await fs.writeFile(path.join(f.processed,'2.png'),'changed');
    await expect(approveBatch({...f.options,all:true})).rejects.toThrow('cutout digest mismatch');
    expect(await fs.readFile(f.manifestPath)).toEqual(before);
    f.manifest.entries[0].cutoutSha256='a'.repeat(64);await f.save();
    await expect(approveBatch({...f.options,items:'1'})).rejects.toThrow('Review mapping is stale');
  });
  it('rejects symlink sources without approving',async()=>{
    const f=await fixture();await fs.rename(path.join(f.incoming,'1.jpg'),path.join(f.root,'outside.jpg'));
    await fs.symlink(path.join(f.root,'outside.jpg'),path.join(f.incoming,'1.jpg'));
    await expect(approveBatch({...f.options,items:'1'})).rejects.toThrow('symlink path escapes');
  });
  it('requires exactly one selection mode and valid item numbers',async()=>{
    const f=await fixture();
    for(const options of [{},{all:true,items:'1'}])await expect(approveBatch({...f.options,...options})).rejects.toThrow('Choose exactly one');
    await expect(approveBatch({...f.options,items:'1',except:'2'})).rejects.toThrow('--except');
    for(const items of ['0','4','3-1','1,x'])await expect(approveBatch({...f.options,items})).rejects.toThrow(/Item numbers/);
  });
});
