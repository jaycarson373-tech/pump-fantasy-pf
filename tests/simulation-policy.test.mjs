import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSuccessfulSimulation} from '../lib/server/simulation-policy.ts';
test('fee collection and award preparation require explicit simulation success',()=>{
  for(const result of [null,undefined,{}, {value:null},{value:{}},{value:{err:false}},{value:{err:0}},{value:{err:{InstructionError:[0,'failure']}}}])
    assert.throws(()=>requireSuccessfulSimulation(result),/simulation|Simulation/);
  assert.doesNotThrow(()=>requireSuccessfulSimulation({value:{err:null}}));
});
