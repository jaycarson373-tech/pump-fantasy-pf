const actions = new Map([['open','open'],['test-open','test-open'],['test-close','test-close']]);
const action = actions.get(process.argv[2] || 'open');
if (!action) throw new Error('Use open, test-open, or test-close.');
const secret = process.env.PF_DATA_INGEST_SECRET;
if (!secret) throw new Error('Inject PF_DATA_INGEST_SECRET from the backend service before running this command.');
const base = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pumpfunfantasy.xyz');
if (base.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(base.hostname)) throw new Error('Use HTTPS for the draft service.');
const response = await fetch(new URL('/api/admin/season/start',base), {
 method:'POST', headers:{'content-type':'application/json',authorization:`Bearer ${secret}`},
 body:JSON.stringify({action}), signal:AbortSignal.timeout(60000),
});
const body=await response.json();
if (!response.ok) {
 console.error(body.error || 'Draft action failed.');
 for (const blocker of body.blockers || []) console.error(blocker);
 process.exitCode=1;
} else console.log(JSON.stringify(body,null,2));
