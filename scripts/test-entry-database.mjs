// Runs against temporary tables only. No season or entry in public is changed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const client = new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
try {
 await client.connect();
 await client.query('begin');
 await client.query('create temporary table pf_seasons (like public.pf_seasons including all) on commit drop');
 await client.query('create temporary table pf_entries (like public.pf_entries including all) on commit drop');
 const code = await readFile('app/api/entry/route.ts','utf8');
 const sql = code.match(/queryRows<\{ wallet: string \}>\("(insert into pf_entries.*?)", \[season,/s)?.[1];
 assert.ok(sql,'Use the actual production persistence query');
 await client.query("insert into pf_seasons(id,title,status,opens_at,locked_at,closes_at) values('integration','test','open',now()-interval '1 minute',now()+interval '59 minutes',now()+interval '49 hours')");
 const wallet='11111111111111111111111111111111';
 const save=()=>client.query(sql,['integration',wallet,JSON.stringify(['a','b','c','d','e']),'500000000000']);
 assert.equal((await save()).rowCount,1,'An open draft accepts an entry');
 assert.equal((await save()).rowCount,1,'A resubmission updates the existing wallet entry');
 assert.equal(Number((await client.query('select count(*) from pf_entries')).rows[0].count),1,'A wallet has exactly one entry');
 await client.query("update pf_seasons set locked_at=now()-interval '1 second' where id='integration'");
 assert.equal((await save()).rowCount,0,'A deadline race cannot overwrite a locked entry');
 await client.query("update pf_seasons set locked_at=now()+interval '59 minutes',opens_at=now()+interval '1 minute' where id='integration'");
 assert.equal((await save()).rowCount,0,'Entries cannot be saved before opening');
 await client.query('rollback');
 console.log('PASS: real entry SQL accepts open drafts, updates once per wallet, rejects before open and after lock. All temporary test data rolled back.');
} finally { await client.end(); }
