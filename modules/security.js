import Module from "./module.js"

export default class SecurityModule extends Module {

    zones = []

    constructor(config, dovit, mqtt) {
        super("Alarm App", config, dovit, mqtt)
    }

    async handleSubfunction(device, func, message) {
        this.zones[device.zone.id] = this.zones[device.zone.id] || {}

        switch (func.subfunction) {
            case "presence sensor":
                this.zones[device.zone.id]["occupancy"] = message.statevalue == 1 ? true : false
                break;
            case "partition alarm":
                this.zones[device.zone.id]["armed"] = message.statevalue == 1 ? true : false
                break;
            case "partition":
                this.zones[device.zone.id]["arming"] = message.statevalue == 1 ? true : false
                break;
            case "diagnosis":
                break;
            default:
                console.log("--- ALARM ---")
                console.log(func.subfunction)
                console.log(device)
                console.log(message)
        }

        this.mqtt.publish(`${this.config.mqtt.topic}/${func.functionId}-${device.zone.id}`, JSON.stringify(this.zones[device.zone.id]))
    }

}