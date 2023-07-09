import Module from "./module.js"

export default class LightsModule extends Module {

    lights = []

    constructor(config, dovit, mqtt) {
        super("Lights App", config, dovit, mqtt)
    }

    async handleSubfunction(device, func, message) {
        this.lights[device.id] = this.lights[device.id] || {}

        switch (func.subfunction) {
            case "on / off":
                this.lights[device.id]["state"] = message.statevalue == 1 ? "ON" : "OFF"
                break;
            default:
                console.log("--- LIGHTS ---")
                console.log(func.subfunction)
                console.log(device)
                console.log(message)
        }

        this.mqtt.publish(`${this.config.mqtt.topic}/${func.functionId}-${device.id}`, JSON.stringify(this.lights[device.id]))
    }

}