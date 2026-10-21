import { chromium } from 'playwright';
const cookie = process.argv[2];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1440,height:900} });
await ctx.addCookies([{ name:'session_token', value:cookie, domain:'localhost', path:'/', httpOnly:true, secure:false, sameSite:'Lax' }]);
const p = await ctx.newPage();
p.on('console', m => { if (m.type()==='error') console.log('CONSOLE ERR:', m.text().slice(0,200)); });
await p.goto('http://localhost:4400/', { waitUntil:'networkidle', timeout:30000 }).catch(e=>console.log('nav err', e.message));
await p.waitForTimeout(2500);
console.log('URL:', p.url());
const me = await p.evaluate(async () => {
  const r = await fetch('http://localhost:8000/auth/me', { credentials:'include' });
  return r.status + ' ' + (await r.text()).slice(0,200);
});
console.log('auth/me:', me);
console.log('h1:', await p.locator('h1').allTextContents());
await b.close();
