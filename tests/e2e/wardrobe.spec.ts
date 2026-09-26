import { test, expect } from '@playwright/test';
import { getWardrobeRepository } from '../../src/lib/data/wardrobe-repository';
import { CLOTHING_TYPES } from '../../src/lib/contracts/wardrobe';

test('anonymous pages and image bytes are protected', async ({page,request})=>{
 const id=process.env.E2E_ITEM_ID!;
 for(const url of ['/api/items',`/api/items/${id}`,`/api/items/${id}/image?variant=cutout`,`/api/items/${id}/image?variant=original`]) {
  const response=await request.get(url); expect(response.status()).toBe(401); expect(response.headers()['content-type']).toContain('application/json');
 }
 await page.goto('/'); await expect(page).toHaveURL(/\/sign-in/);
});

test('owner can browse protected images and persist a type correction',async({browser,baseURL},testInfo)=>{
 const context=await browser.newContext({storageState:process.env.E2E_AUTH_STATE!,baseURL,viewport:testInfo.project.name==='phone'?{width:390,height:844}:{width:1440,height:1000}});
 const page=await context.newPage(); const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
 const repository=getWardrobeRepository(); const id=process.env.E2E_ITEM_ID!; const original=await repository.getActiveById(id); expect(original).not.toBeNull();
 const nextType=CLOTHING_TYPES.find(t=>t!==original!.type)!;
 try {
  await page.goto('/'); await expect(page.getByRole('heading',{name:'Wardrobe',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const listing=await context.request.get('/api/items'); expect(listing.status()).toBe(200);
  const payload=await listing.json(); expect(payload.total).toBe((await repository.listActive()).length); expect(payload.counts).toEqual(await repository.countActiveByType());
  await page.goto(`/items/${id}`);
  for(const variant of ['original','cutout']) {const image=await context.request.get(`/api/items/${id}/image?variant=${variant}`); expect(image.status()).toBe(200); expect(image.headers()['content-type']).toMatch(/^image\//); expect(image.headers()['cache-control']).toContain('no-store');}
  await page.getByRole('button',{name:/original photo/i}).click();
  const response=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith(`/api/items/${id}`));
  await page.getByRole('combobox').selectOption(nextType); expect((await response).status()).toBe(200);
  await expect.poll(async()=> (await repository.getActiveById(id))?.type).toBe(nextType);
  await page.reload(); await expect(page.getByRole('combobox')).toHaveValue(nextType);
  await page.goto(`/?type=${nextType}`); const filtered=await context.request.get(`/api/items?type=${nextType}`); expect((await filtered.json()).items.every((i:{type:string})=>i.type===nextType)).toBe(true);
  await page.screenshot({path:`test-results/${testInfo.project.name}-wardrobe.png`,fullPage:true}); expect(errors).toEqual([]);
 } finally {await repository.updateType(id,original!.type); await context.close();}
});

test('confirmed removal hides detail and both images while preserving the record',async({browser,baseURL},testInfo)=>{
 test.skip(testInfo.project.name!=='desktop','Run destructive disposable-fixture check once after phone browsing.');
 const id=process.env.E2E_REMOVAL_ITEM_ID!;
 const context=await browser.newContext({storageState:process.env.E2E_AUTH_STATE!,baseURL});
 const page=await context.newPage(); const repository=getWardrobeRepository();
 const document=await repository.getActiveById(id);expect(document).not.toBeNull();
 const before=(await repository.listActive()).length;
 try {
  await page.goto(`/items/${id}`);page.once('dialog',dialog=>dialog.accept());
  const deletion=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().endsWith(`/api/items/${id}`));
  await page.getByRole('button',{name:'Remove from catalogue',exact:true}).click();expect((await deletion).status()).toBe(204);
  await expect(page).toHaveURL(`${baseURL}/`);expect((await repository.listActive()).length).toBe(before-1);
  for(const path of [`/api/items/${id}`,`/api/items/${id}/image?variant=original`,`/api/items/${id}/image?variant=cutout`])expect((await context.request.get(path)).status()).toBe(404);
  expect((await repository.findBySourceHash(document!.sourceSha256))?.deletedAt).toBeTruthy();
  const { getImageStore }=await import('../../src/lib/storage/blob');
  for(const image of [document!.images.original, document!.images.cutout, ...(document!.images.thumbnails ?? [])]){const stored=await getImageStore().readPrivate(image);expect(stored).not.toBeNull();await stored?.body.cancel();}
  expect((await context.request.delete(`/api/items/${id}`,{headers:{Origin:baseURL!}})).status()).toBe(204);
 }finally{await context.close();}
});
