import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { Sha256Schema } from '../src/lib/contracts/batch';
import { loadBatch, readInside, validatePreparedEntry } from './lib/batch-files';

const ReviewIndexSchema = z.object({ batchId: z.string(), entries: z.array(z.object({number:z.number().int().positive(),sourceSha256:Sha256Schema,cutoutSha256:Sha256Schema.nullable()}).strict()) }).strict();
export interface ApprovalOptions {
  batch: string; root?: string; all?: boolean; items?: string; except?: string;
  acceptWarnings?: boolean; dryRun?: boolean;
}
function numbers(value: string, maximum: number): number[] {
  const selected = new Set<number>();
  for (const token of value.split(',')) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token.trim());
    if (!match) throw new Error('Item numbers must look like 1,3,5-7.');
    const first=Number(match[1]), last=Number(match[2] ?? match[1]);
    if (first < 1 || last < first || last > maximum) throw new Error(`Item numbers must be between 1 and ${maximum}.`);
    for(let n=first;n<=last;n++) selected.add(n);
  }
  return [...selected].sort((a,b)=>a-b);
}

export async function approveBatch(options: ApprovalOptions) {
  if (Boolean(options.all) === Boolean(options.items)) throw new Error('Choose exactly one of --all or --items.');
  if (options.except !== undefined && !options.all) throw new Error('--except can only be used with --all.');
  const {manifest,manifestBytes: original,processed,incoming}=await loadBatch(options.root ?? process.cwd(),options.batch);
  const review = ReviewIndexSchema.parse(JSON.parse((await readInside(processed,'review-index.json')).toString('utf8')));
  if(review.batchId!==manifest.batchId)throw new Error('Review index belongs to another batch. Regenerate review sheets.');
  const excluded=new Set(options.except ? numbers(options.except,manifest.entries.length):[]);
  const selected=(options.all ? manifest.entries.map((_,i)=>i+1):numbers(options.items!,manifest.entries.length)).filter(n=>!excluded.has(n));
  if(!selected.length)throw new Error('No entries selected for approval.');
  const failures:string[]=[];
  for(const number of selected){
    const entry=manifest.entries[number-1];
    try{
      if(entry.reviewStatus==='rejected')throw new Error('Entry is rejected; exclude it or explicitly return it to pending before review.');
      const matching=review.entries.filter(e=>e.number===number);
      if(matching.length!==1 || matching[0].sourceSha256!==entry.sourceSha256 || matching[0].cutoutSha256!==entry.cutoutSha256)throw new Error('Review mapping is stale. Regenerate and inspect the review sheets.');
      if(entry.warnings.length && !options.acceptWarnings)throw new Error('Has review warnings; inspect them, then use --accept-warnings to approve as-is.');
      await validatePreparedEntry(incoming,processed,entry);
    }catch(error){failures.push(`#${number}: ${error instanceof Error?error.message:'Validation failed'}`);}
  }
  if(failures.length)throw new Error(`Nothing approved:\n${failures.join('\n')}`);
  const changed=selected.filter(n=>manifest.entries[n-1].reviewStatus!=='approved');
  if(!options.dryRun && changed.length){
    for(const number of selected)manifest.entries[number-1].reviewStatus='approved';
    if(!(await readInside(processed,'manifest.json')).equals(original))throw new Error('Manifest changed during validation; retry after reviewing it.');
    const temp=path.join(processed,`.manifest-approval-${randomUUID()}.tmp`);
    try{await fs.writeFile(temp,JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(temp,path.join(processed,'manifest.json'));}
    finally{await fs.rm(temp,{force:true});}
  }
  return {batchId:manifest.batchId,selected,changed:changed.length,alreadyApproved:selected.length-changed.length,dryRun:Boolean(options.dryRun)};
}

const help=`Approve reviewed local photos; this command does not import them.
Usage: npm run wardrobe:approve -- --batch <id> (--all | --items 1,3-5)
       [--except 2,6] [--accept-warnings] [--dry-run]
Generate and inspect review sheets first. Every selected entry must have a type,
current review mapping, matching source/cutout hashes, and valid image files.
Approval is all-or-nothing. Rejected entries are never silently approved.`;
async function cli(){
  const {values}=parseArgs({options:{batch:{type:'string'},all:{type:'boolean'},items:{type:'string'},except:{type:'string'},'accept-warnings':{type:'boolean'},'dry-run':{type:'boolean'},help:{type:'boolean'}},strict:true,allowPositionals:false});
  if(values.help){console.log(help);return;}
  if(!values.batch)throw new Error(help);
  const result=await approveBatch({batch:values.batch,all:values.all,items:values.items,except:values.except,acceptWarnings:values['accept-warnings'],dryRun:values['dry-run']});
  console.log(`${result.dryRun?'Would approve':'Approved'} ${result.selected.length} selected entries (${result.alreadyApproved} already approved). Numbers: ${result.selected.join(', ')}.`);
  if(!result.dryRun)console.log(`Next: regenerate review sheets to refresh their status labels, then npm run wardrobe:import -- --batch ${result.batchId} --dry-run`);
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){cli().catch(e=>{console.error(`approve-batch: ${e instanceof Error?e.message:'Approval failed'}`);process.exitCode=1;});}
