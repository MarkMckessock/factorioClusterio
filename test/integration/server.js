const assert = require("assert").strict;
const fs = require("fs-extra");
const path = require("path");

const factorio = require("lib/factorio");


describe("Integration of lib/factorio/server", function() {
	describe("_getVersion()", function() {
		it("should get a version from factorio's changelog.txt", async function() {
			let version = await factorio._getVersion(path.join("factorio", "data", "changelog.txt"));
			if (!/^\d+\.\d+\.\d+$/.test(version)) {
				assert.fail(`Detected version '${version}' does not followed the format x.y.z`);
			}
		});
	});

	describe("class FactorioServer", function() {
		let writePath = path.join("test", "temp", "integration");
		let server = new factorio.FactorioServer(path.join("factorio", "data"), writePath, {});
		let logFile;

		before(async function() {
			// Delete result from previous run of these tests
			if (fs.existsSync(writePath)) {
				await fs.remove(writePath);
			}

			await fs.ensureDir(writePath);
			logFile = fs.createWriteStream(path.join(writePath, "log.txt"), "utf8");
			server.on('output', function(output) {
				logFile.write(JSON.stringify(output) + "\n");
			});

			// Initialize sever.
			await server.init();
		});

		after(function() {
			logFile.end();
		});

		describe(".exampleSettings()", function() {
			let settings;
			it("returns an object", async function() {
				settings = await server.exampleSettings();
				assert(typeof settings === "object");
			});

			it("contains the settings used by Clusterio", async function() {
				let keysUsed = new Set([
					"name", "description", "tags", "max_players", "visibility", "username", "token",
					"game_password", "require_user_verification", "allow_commands", "autosave_interval",
					"autosave_slots", "afk_autokick_interval", "auto_pause",
				]);

				for (let key of Object.keys(settings)) {
					keysUsed.delete(key);
				}

				assert(
					keysUsed.size === 0,
					`Factorio's server-settings.example.json does not contain the key(s) ${[...keysUsed]}`
				);
			});
		});

		// Mark that this test takes a lot of time, or depeneds on a test
		// that takes a lot of time.
		function slowTest(test) {
			if (process.env.FAST_TEST) {
				test.skip();
			}

			test.timeout(20000);
		}

		function log(message) {
			logFile.write("=================== " + message + "\n");
		}

		describe(".create()", function() {
			it("creates a map file at writeDir/saves/name", async function() {
				slowTest(this);
				log(".create() with new save");

				// Make sure the test is not fooled by previous data
				let mapPath = server.writePath("saves", "test.zip");
				assert(!await fs.exists(mapPath), "save exist before test");

				await server.create("test.zip");
				assert(await fs.exists(mapPath), "test did not create save");
			});
		});

		describe(".start()", function() {
			it("starts the server", async function() {
				slowTest(this);
				log(".start()");

				// Make sure the test does not fail due to create() failing.
				let mapPath = server.writePath("saves", "test.zip");
				assert(await fs.exists(mapPath), "save is missing");

				await server.start("test.zip");
			});
		});

		describe(".disableAchievments()", function() {
			it("disables acheivements", async function() {
				slowTest(this);
				log(".disableAchievements()");
				assert.equal(await server.disableAchievements(), true);
			});

			it("can tell when acheivements were disabled", async function() {
				slowTest(this);
				assert.equal(await server.disableAchievements(), false);
			});
		});

		describe(".sendRcon()", function() {
			it("returns the result of a command", async function() {
				slowTest(this);
				log(".sendRcon()");

				let result = await server.sendRcon("/sc rcon.print('success')");
				assert.equal(result, 'success\n');
			});
		});

		describe(".stop()", function() {
			it("stops the server", async function() {
				slowTest(this);
				log(".stop()");

				await server.stop();
			});
		});

		describe(".startScenario()", function() {
			before("Write test_scenario", async function() {
				let content = "script.on_init(function() print('test_scenario init') end)\n";
				await fs.outputFile(server.writePath("scenarios", "test_scenario", "control.lua"), content);
			});

			it("runs the given scenario", async function() {
				slowTest(this);
				log(".startScenario()");

				let pass = false
				function filter(output) {
					if (output.message === "test_scenario init") {
						pass = true;
					}
				}
				server.on('output', filter);

				await server.startScenario("test_scenario");

				log(".stop()");
				await server.stop();

				server.off('output', filter);
				assert(pass, "server did not output line from test scenario");
			});
		});
	});
});
