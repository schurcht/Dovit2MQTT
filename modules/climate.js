import Module from "./module.js"

export default class ClimateModule extends Module {

    zones = []

    constructor(config, dovit, mqtt) {
        super("Clima App", config, dovit, mqtt)
    }

    async handleSubfunction(device, func, message) {
        this.zones[device.zone.id] = this.zones[device.zone.id] || {}

        switch (func.subfunction) {
            case "temperature":
                this.zones[device.zone.id]["local_temperature"] = message.statevalue
                break;
            case "set point T":
                this.zones[device.zone.id]["occupied_heating_setpoint"] = message.statevalue
                break;
            case "valve":
                this.zones[device.zone.id]["valve_state"] = message.statevalue == 1 ? "open" : "closed"
                break;
            case "season mode":
                this.zones[device.zone.id]["season_mode"] = message.statevalue == 1 ? "winter" : "summer"
                break;
            case "main pump":
                this.zones[device.zone.id]["pump"] = message.statevalue == 1 ? "on" : "off"
                break;
            default:
                console.log(func)
                console.log(message)
        }

        this.mqtt.publish(`${this.config.mqtt.topic}/${device.name}`, JSON.stringify(this.zones[device.zone.id]))
    }

}