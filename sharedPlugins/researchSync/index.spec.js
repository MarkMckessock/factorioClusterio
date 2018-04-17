const assert = require("assert");

const isFactorioCommand = require("_app/isFactorioCommand");

const researchSync = require("./index.js");

describe("researchSync/index.js", ()=>{
	it("exports a single class (or at least a function)", ()=>{
		assert.equal(typeof researchSync, "function");
	});
	describe("class researchSync()", ()=>{
		it(".filterResearchDiff(object1, object2) returns research that needs enabling on the local instance", ()=>{
			let reSync = new researchSync({}, function(){});
			
			let obj1 = {
				a:[true, 0],
				b:[true, 0],
				c:[false, 0],
				d:[false, 10],
			};
			let obj2 = {
				a:[true, 0],
				b:[true, 1],
				c:[false, 0],
				e:[false, 50],
			};
			assert(typeof reSync.filterResearchDiff == "function");
			
			let diffResult = reSync.filterResearchDiff(obj1, obj2);
			assert(diffResult.a === undefined);
			assert(diffResult.b === [true, 1]);
			assert(diffResult.d === undefined);
			assert(diffResult.e === [false, 50]);
		});
		it(".pollResearch() dumps a long Lua command", ()=>{
			let reSync = new researchSync({}, io);
			let ioRecieved;
			function io(str){
				ioRecieved = true;
				assert(isFactorioCommand(str), "pollResearch should run a command");
			}
			
			assert(!ioRecieved);
			
			reSync.pollResearch();
			
			assert(ioRecieved);
		});
		describe(".scriptOutput(data) handles file writes from factorio", ()=>{
			it("wants a key:value pair of a single research, parses and saves it", ()=>{
				let reSync = new researchSync({hi:"hello"}, console.log);
				let researches = [
					'automation:false',
					'automation-2:false',
					'automation-3:false',
					'electronics:false',
					'advanced-electronics:false',
					'advanced-electronics-2:false',
					'circuit-network:false',
					'explosives:false',
					'logistics:false',
					'logistics-2:false',
					'logistics-3:false',
					'optics:false',
					'laser:false',
					'solar-energy:false',
					'turrets:false',
					'laser-turrets:false',
					'stone-walls:false',
					'gates:false',
					'engine:false',
				]
				researches.forEach(research => {
					reSync.scriptOutput(research);
					assert(!isFactorioCommand("/c x = "+research));
				});
				assert(Object.keys(reSync.research).length == researches.length);
			});
		});
		it("regularily polls and syncs research (configurable delay)", (done)=>{
			let reSync = new researchSync({}, io, {
				researchSyncPollInterval: 100,
			});
			let ioRecieved;
			function io(str){
				ioRecieved = true;
				assert(isFactorioCommand(str), "pollResearch should run a command");
			}
			function waitForIo(){
				if(!ioRecieved){
					setTimeout(waitForIo,50);
				} else {
					done();
				}
			}
			waitForIo();
		});
	});
});
