import Module from "./module.js"

export default class ClimateModule extends Module {

    zones = []
    temperature_sensors = []

    constructor(config, dovit, mqtt) {
        dovit.loadDevices().then(devices => {
            var sensors = devices.filter(e => e.functions.find(f => f.subfunction == "temperature"))

            for (var sensor of sensors) {
                this.temperature_sensors[sensor.id] = { id: sensor.id, name: `${sensor.zone.name} ${sensor.name}` }
            }

            this.publishDevices()
        })

        super("Clima App", config, dovit, mqtt)
    }

    async handleSubfunction(device, func, message) {
        this.zones[device.zone.id] = this.zones[device.zone.id] || {}

        switch (func.subfunction) {
            case "temperature":
                this.zones[device.zone.id]["local_temperature"] = message.statevalue
                console.log("Updating temperature for zone " + device.zone.name + " to " + message.statevalue)
                this.mqtt.publish(`${this.config.mqtt.topic}/${device.id}/state`, message.statevalue.toString())
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

    async publishDevices() {
        this.temperature_sensors.forEach(sensor => {
            this.mqtt.publish(`homeassistant/sensor/${this.config.mqtt.topic}_${sensor.id}/config`, JSON.stringify({
                name: sensor.name,
                device_class: "temperature",
                unit_of_mesaurement: "°C",
                state_topic: `${this.config.mqtt.topic}/${sensor.id}/state`,
            }))
        })
    }

}