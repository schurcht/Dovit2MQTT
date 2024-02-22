import Module from "./module.js"

export default class SecurityModule extends Module {

    zones = []
    motionSensors = []

    constructor(config, dovit, mqtt) {

        dovit.loadDevices().then(devices => {
            var motionSensors = devices.filter(e => e.functions.find(f => f.subfunction == "presence sensor" || f.subfunction == "sensor state"))

            for (var motionSensor of motionSensors) {
                this.motionSensors[motionSensor.id] = { id: motionSensor.id, name: motionSensor.name, state: "OFF" }
            }

            this.publishDevices()
        })

        super("Alarm App", config, dovit, mqtt)
    }

    async handleSubfunction(device, func, message) {
        this.zones[device.zone.id] = this.zones[device.zone.id] || {}

        switch (func.subfunction) {
            case "presence sensor":
            case "sensor state":
                this.zones[device.zone.id]["occupancy"] = message.statevalue == 1 ? true : false
                console.log("Trigger motion on " + device.name)
                this.mqtt.publish(`${this.config.mqtt.topic}/${device.id}/state`, message.statevalue == 1 ? "ON" : "OFF")
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

        this.mqtt.publish(`${this.config.mqtt.topic}/${device.name}`, JSON.stringify(this.zones[device.zone.id]))
    }

    async publishDevices() {
        this.motionSensors.forEach(sensor => {
            console.log(`Publishing motion sensor ${sensor.name} with id ${sensor.id}`)
            this.mqtt.publish(`homeassistant/binary_sensor/${this.config.mqtt.topic}_${sensor.id}/config`, JSON.stringify({
                name: sensor.name,
                unique_id: `${this.config.mqtt.topic}_${sensor.id}`,
                device_class: "motion",
                state_topic: `${this.config.mqtt.topic}/${sensor.id}/state`,
                payload_on: "ON",
                payload_off: "OFF",
                icon: "mdi:motion-sensor"
            }))
        })
    }

}