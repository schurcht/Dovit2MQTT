import mqttClient from 'mqtt'
import Dovit from "./dovit.js"
import ClimateModule from "./modules/climate.js"
import SecurityModule from './modules/security.js';
import LightsModule from './modules/lights.js';
import CoveringModule from './modules/covering.js';

export default class Bridge {

    constructor(config) {
        this.config = config;
        this.devices = [];
        this.loadedModules = []
    }

    start() {
        return new Promise((resolve) => {
            this.dovit = new Dovit(this.config.dovit.ip, this.config.dovit.dpPort, this.config.dovit.uiPort)
            this.mqtt = mqttClient.connect(this.config.mqtt.url, {
                username: this.config.mqtt.username,
                password: this.config.mqtt.password
            })

            this.loadedModules = [
                new ClimateModule(this.config, this.dovit, this.mqtt),
                new SecurityModule(this.config, this.dovit, this.mqtt),
                new LightsModule(this.config, this.dovit, this.mqtt)
                //new CoveringModule(this.config, this.dovit, this.mqtt)
            ]

            var mqttConn = new Promise((resolve) => {
                this.mqtt.on('connect', async () => {
                    resolve();
                })
            })

            Promise.all([mqttConn, this.dovit.connect()]).then(() => {
                console.log("Connected to Dovit and MQTT")
                this.__handleBridgeUpdate();
                setInterval(() => this.__handleBridgeUpdate(), 60000)

                this.dovit.on("deviceUpdate", (newState) => {
                    this.__handleEventConversion(newState, this.devices.find(device => device.id == newState["@_id"]))
                })
                resolve();
            })
        })
    }

    async __handleBridgeUpdate() {
        console.log("Updating bridge status on MQTT")
        this.devices = await this.dovit.getAllDevices();
        this.mqtt.publish(`${this.config.mqtt.topic}/bridge/devices`, JSON.stringify(this.devices))
        this.mqtt.publish(`${this.config.mqtt.topic}/bridge/state`, JSON.stringify({ state: "online" }))
    }

    __handleEventConversion(event, device) {
        if (!device) {
            return
        }

        for (var func of device.functions) {
            const module = this.loadedModules.find(e => e.moduleName == func.function)

            if (module) {
                module.handleSubfunction(device, func, event)
            } else {
                //console.log("No module found for function", func.function)
            }
        }
    }
}