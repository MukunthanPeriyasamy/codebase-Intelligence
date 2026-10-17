const assert = require('node:assert/strict');
const net = require('node:net');
const {assertPortFree,waitForBackend}=require('../scripts/run-services.cjs');
(async()=>{
 const server=net.createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 await assert.rejects(assertPortFree(port), /in use/);
 await new Promise(resolve=>server.close(resolve));
 await assertPortFree(port);
 const original=global.fetch;
 try {
  let calls=0;
  global.fetch=async()=>{calls++; return Response.json(calls===1?{status:'unavailable'}:{status:'ready',service:'deepwiki-api'});};
  await waitForBackend(()=>true,1500);
  assert.equal(calls,2);
  await assert.rejects(waitForBackend(()=>false), /exited/);
  global.fetch=async()=>Response.json({status:'ready',service:'wrong-service'});
  await assert.rejects(waitForBackend(()=>true,10), /timed out/);
 } finally {global.fetch=original;}
 console.log('Service startup readiness and port-conflict tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
