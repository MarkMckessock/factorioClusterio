const fs = require('fs');
const path = require('path')
const needle = require("needle");


function time() {
    let d = new Date()
    return `${d.getUTCHours()}:${d.getUTCMinutes()}:${d.getUTCSeconds()}.${d.getUTCMilliseconds()}`
}

class ResearchSync {
    constructor(slaveConfig, messageInterface, extras = {}){
        this.config = slaveConfig
        this.messageInterface = messageInterface

        this.functions = {
            dumpResearch: this.loadFunc("dumpResearch.lua"),
			enableResearch: this.loadFunc("enableResearch.lua"),
            updateProgress: this.loadFunc("updateProgress.lua")
        }

        this.log_folder = './logs'
        if (!fs.existsSync(this.log_folder))
            fs.mkdirSync(this.log_folder);
        this.log_file = path.join(this.log_folder, `${this.config.instanceName}-research.log`)

        this.research = {}
        this.prev_research = {}
        this.initial_request_own_data(
            () => this.setup_sync_task(extras)
        )
    }

    log(data) {
        try {
            console.log(`researchSync: ${data}`)
            fs.appendFileSync(this.log_file, `${time()}: ${data}\n`);
        } catch (e) {
            console.error(e)
        }
    }

    error(data) {
        try {
            console.error(`researchSync: ${data}`)
            fs.appendFileSync(this.log_file, `${time()}: ${data}\n`);
        } catch (e) {
            console.error(e)
        }
    }

    initial_request_own_data(callback) {
        const url = `${this.config.masterURL}/api/getSlaveMeta`
        const data = {
            instanceID: this.config.unique,
            password: this.config.clientPassword,
        }
        const options = {
            headers: {'x-access-token': this.config.masterAuthToken},
            json: true,
            compressed: true
        }
        needle.post(url, data, options, (err, res, techs) => {
            if (err) {
                this.log(`Can't get own slave data:`)
                this.error(err)
                return
            }
            if (res.statusCode === 404) {
                this.log('slave is not registered yet. Delaying for 5 secs')
                setTimeout(
                    () => this.initial_request_own_data(callback),
                    5000
                )
                return
            }
            if (res.statusCode !== 200) {
                this.log(`Can't get own slave data:`)
                this.error(`status code ${res.statusCode}, ${res.body}`)
                return
            }
            if(techs.toString()!="") {
                techs = JSON.parse(techs)
                if (typeof techs.research === 'object')
                    this.research = techs.research
                this.log('techs imported from master')
            } else {
                this.log('no techs imported from master, since there are none yet')
            }
            callback()
        })
    }

    setup_sync_task(extras) {
        const timeout = extras.researchSyncPollInterval || 5000
        setInterval(() => this.sync_task(), timeout);
    }

    sync_task() {
        this.messageInterface(this.functions.dumpResearch);
        setTimeout(this.request_cluster_data.bind(this), 2000);
    }

    request_cluster_data() {
        const slaves_data_url = `${this.config.masterURL}/api/slaves`
        needle.get(slaves_data_url, {compressed:true}, this.sync_researches.bind(this))
    }

    sync_researches(err, resp, slaves_data) {
        if (err) {
            this.messageInterface("Unable to post JSON master/api/slaves, master might be unreachable");
            return false;
        }
        if (resp.statusCode !== 200) {
            this.messageInterface("got error when calling slaves", resp.statusCode, resp.body);
            return;
        }

        slaves_data = Object.values(slaves_data)
        slaves_data = slaves_data.filter(
            slave_data => slave_data.unique !== this.config.unique.toString()
                && slave_data.meta && slave_data.meta.research
        )

        this.clear_contribution_to_researched_techs()
        let cluster_techs = this.get_cluster_techs(slaves_data)
        this.recount_cluster_research_progress(slaves_data, cluster_techs)

        let to_research = this.filter_researched_techs(cluster_techs)
        let to_update_progress = this.filter_updated_techs(cluster_techs, to_research)

        this.research_technologies(to_research)
        this.update_technologies_progress(to_update_progress)

        this.print_own_contribution()

        needle.post(this.config.masterURL + '/api/editSlaveMeta', {
            instanceID: this.config.unique,
            password: this.config.clientPassword,
            meta: {research: this.research}
        }, {headers: {'x-access-token': this.config.masterAuthToken}, json: true, compressed:true}, (err, resp) => {
            if (err)
                this.error(err)
        })
    }

	clear_contribution_to_researched_techs() {
		for (let [name, tech] of Object.entries(this.research)) {
			if (!Object.hasOwnProperty.call(this.prev_research, name)) {
				continue;
			}

			let researched;
			if (tech.infinite) {
				researched = this.prev_research[name].level < tech.level;
			} else {
				researched = this.prev_research[name].researched < tech.researched;
			}

			if (researched) {
				tech.contribution = 0;
			}
		}
	}

    get_cluster_techs(slavesData) {
        let cluster_techs = {}
        for (let slave_data of slavesData) {
            let node_researches = slave_data.meta.research
            for (let [name, node_tech] of Object.entries(node_researches)) {
                if (isNaN(node_tech.researched) || isNaN(node_tech.level) || isNaN(node_tech.infinite))
                    continue

                if (Object.hasOwnProperty.call(cluster_techs, name)) {
                    if (cluster_techs[name].infinite === 1 && cluster_techs[name].level < node_tech.level) {
                        cluster_techs[name].level = node_tech.level
                    } else if (node_tech.researched > cluster_techs[name].researched) {
                        cluster_techs[name].researched = 1
                    }
                } else {
                    cluster_techs[name] = node_tech
                }
            }
        }
        return cluster_techs
    }

    recount_cluster_research_progress(slaves_data, cluster_researches) {
        for (let [name, tech] of Object.entries(cluster_researches))
            tech.progress = this.research[name].contribution

        for (let slave_data of slaves_data) {
            for (let [name, tech] of Object.entries(slave_data.meta.research)) {
				if (!Object.hasOwnProperty.call(cluster_researches, name)) {
					continue;
				}

				if (
					isNaN(cluster_researches[name].progress)
					|| isNaN(tech.contribution)
					|| isNaN(tech.level)
					|| isNaN(cluster_researches[name].level)
				) {
					continue;
				}

				if (cluster_researches[name].level === tech.level) {
					cluster_researches[name].progress += tech.contribution;
				}
            }
        }

		for (let [name, tech] of Object.entries(cluster_researches)) {
			if (tech.progress > 1) {
				tech.progress = null
				tech.researched = 1
                this.research[name].contribution = 0
				tech.contribution = 0
				if (this.research[name].level >= tech.level)
					tech.level = this.research[name].level + 1
            }
        }
    }

    filter_researched_techs(cluster_researches) {
        let result = {};
		for (let [name, tech] of Object.entries(this.research)) {
			if (!Object.hasOwnProperty.call(cluster_researches, name)) {
				continue;
			}

			if (isNaN(cluster_researches[name].researched) || isNaN(cluster_researches[name].level))
                continue

            let researched
			if (tech.infinite) {
				researched = tech.level < cluster_researches[name].level;
			} else {
				researched = tech.researched < cluster_researches[name].researched;
			}

            if (researched)
                result[name] = cluster_researches[name]
        }
        return result;
    }

    filter_updated_techs(cluster_techs, to_research) {
        let result = {}
		for (let [name, tech] of Object.entries(this.research)) {
			if (Object.hasOwnProperty.call(to_research, name) || !Object.hasOwnProperty.call(cluster_techs, name)) {
				continue;
			}
            if (isNaN(cluster_techs[name].progress))
                continue

			// Do not update progress for infinite techs with a local level that's higher.
			if (tech.infinite && tech.level > cluster_techs[name].level) {
				continue;
			}

            if (tech.progress < cluster_techs[name].progress)
                result[name] = cluster_techs[name]
        }
        return result
    }

    research_technologies(to_research) {
        for (let name of Object.keys(to_research))
			if (!Object.hasOwnProperty.call(this.research, name)) {
				delete to_research[name];
			}

        const notify = Object.keys(to_research).length === 1
        for (let [name, tech] of Object.entries(to_research)) {
            this.research[name].contribution = 0
            this.research[name].progress = null
            let command = this.functions.enableResearch;
            command = command.replace(/{tech_name}/g, name);
            command = command.replace(/{tech_level}/g, tech.level);
            command = command.replace(/{tech_infinite}/g, tech.infinite);
            command = command.replace(/{tech_progress}/g, tech.progress)
            command = command.replace(/{notify}/g, notify);
            this.messageInterface(command);
            let log_message = tech.infinite
                ? `Unlocking infinite research ${name} at level ${this.research[name].level}`
                : `Unlocking research ${name}`
            this.log(log_message);
            this.messageInterface(log_message);
            this.research[name] = tech;
        }
    }

    update_technologies_progress(to_update) {
        for (let [name, tech] of Object.entries(to_update)) {
			if (!Object.hasOwnProperty.call(this.research, name)) {
				continue;
			}
            let progress = this.research[name].progress
            if (progress === null)
                progress = 'nil'
            let command = this.functions.updateProgress
            command = command.replace(/{tech_name}/g, name)
            command = command.replace(/{last_check_progress}/g, progress)
            command = command.replace(/{new_progress}/g, tech.progress)
            this.messageInterface(command);
            this.log(
                `Updating ${name}: ${this.research[name].progress} += ${tech.progress - this.research[name].progress}`
            );
            this.research[name].progress = tech.progress
        }
    }

    print_own_contribution() {
        for (let [name, tech] of Object.entries(this.research)) {
			if (!Object.hasOwnProperty.call(this.prev_research, name)) {
				continue;
			}
            let diff = this.research[name].contribution - this.prev_research[name].contribution
            if (Math.abs(diff) > Number.EPSILON * 1000)
                this.log(`Own research ${name}: ${this.research[name].progress} += ${diff}`)
        }
    }

    loadFunc(path, silent=true) {
        let command = fs.readFileSync("sharedPlugins/researchSync/" + path,'utf-8')
        command = command.replace(/\r?\n|\r/g,' ')
        command = (silent ? '/silent-command ' : '/c ') + command
        return command;
    }
    scriptOutput(data) {
        let [name, researched, level, progress, infinite] = data.split(":")
        researched = +(researched === 'true')
        infinite = +(infinite === 'true')
        level = parseInt(level);
        if (progress === 'nil')
            progress = null
        else
            progress = parseFloat(progress)

        if (isNaN(level) || isNaN(researched))
            return

		if (Object.hasOwnProperty.call(this.research, name)) {
			this.prev_research[name] = this.research[name];
		} else {
            this.prev_research[name] = {
                researched: null,
                level: null,
                progress: null,
                contribution: 0,
                infinite,
            }
        }
        this.research[name] = {
            researched,
            level,
            progress,
            contribution: this.prev_research[name].contribution,
            infinite
        }
        if (this.prev_research[name].progress && this.research[name].progress) {
            // this.prev_research[name].progress gets updated to overall cluster progress
            // therefore contribution should be own research progress change over sync interval
            let contribution = this.research[name].progress - this.prev_research[name].progress
            this.research[name].contribution += contribution
        }
        if (Math.abs(this.research[name].contribution) < Number.EPSILON * 1000) {
            // if contribution should be 0 but because of floating-point precision is e.g. 2.2564e-18
            this.research[name].contribution = 0
        }
    }
}

module.exports = ResearchSync;
