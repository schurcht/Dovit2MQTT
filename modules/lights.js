import Module from "./module.js"

export default class LightsModule extends Module {

    // Climate module groups into zones all the functions related to climate control
    zones = []

    constructor(config, dovit, mqtt) {
        super("Lights App", config, dovit, mqtt)
    }

    async handleSubfunction(device, func, message) {
        this.zones[device.zone.id] = this.zones[device.zone.id] || {}

        switch (func.subfunction) {
            case "on / off":
                this.zones[device.zone.id]["state"] = message.statevalue == 1 ? "ON" : "OFF"
                break;
            default:
                console.log("--- LIGHTS ---")
                console.log(func.subfunction)
                console.log(device)
                console.log(message)
        }

        this.mqtt.publish(`${this.config.mqtt.topic}/${func.functionId}${device.zone.id}`, JSON.stringify(this.zones[device.zone.id]))
    }

}