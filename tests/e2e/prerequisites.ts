import { existsSync } from 'node:fs';
export default function prerequisites() {
 const missing = ['E2E_BASE_URL','E2E_AUTH_STATE','E2E_ITEM_ID','E2E_REMOVAL_ITEM_ID','MONGODB_URI','MONGODB_DB'].filter(k=>!process.env[k]);
 if(missing.length) throw new Error(`Live E2E prerequisites missing: ${missing.join(', ')}. See docs/setup.md. Start a dedicated instance on port 3100 using a disposable wardrobe_e2e_<run-id> database, import synthetic fixtures, and save a real owner OAuth session locally.`);
 if(!process.env.MONGODB_DB!.startsWith('wardrobe_e2e_')) throw new Error('E2E requires a disposable MONGODB_DB beginning wardrobe_e2e_; never target the normal catalogue.');
 if(!existsSync(process.env.E2E_AUTH_STATE!)) throw new Error('E2E_AUTH_STATE does not exist. Save a real owner OAuth session; no auth bypass is available.');
}
