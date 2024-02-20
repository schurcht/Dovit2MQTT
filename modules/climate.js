import Module from "./module.js"

export default class ClimateModule extends Module {

    zones = []
    temperature_sensors = []
    zone_desired_temperature = []

    constructor(config, dovit, mqtt) {
        dovit.loadDevices().then(devices => {
            var sensors = devices.filter(e => e.functions.find(f => f.subfunction == "temperature"))

            for (var sensor of sensors) {
                this.temperature_sensors[sensor.id] = { id: sensor.id, name: `${sensor.zone.name} ${sensor.name}`, zone: sensor.zone }
            }

            var desiredTemperature = devices.filter(e => e.functions.find(f => f.subfunction == "set point T"))

            for (var sensor of desiredTemperature) {
                this.zone_desired_temperature[sensor.zone.id] = sensor
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
                this.mqtt.publish(`${this.config.mqtt.topic}/thermostat_${device.zone.id}/temperature`, message.statevalue.toString())
                break;
            case "set point T":
                this.zones[device.zone.id]["occupied_heating_setpoint"] = message.statevalue
                console.log('Updating desired temperature for zone ' + device.zone.name + ' to ' + message.statevalue)
                this.mqtt.publish(`${this.config.mqtt.topic}/thermostat_${device.zone.id}/temperature_desired`, message.statevalue.toString())
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
                console.warn("--- CLIMATE (Unknown function) ---")
                console.log({
                    id: device.id,
                    name: device.name,
                    func,
                    message
                })
        }

        //console.log(this.zones[device.zone.id])

        this.mqtt.publish(`${this.config.mqtt.topic}/${device.name}`, JSON.stringify(this.zones[device.zone.id]))
    }

    async publishDevices() {
        this.temperature_sensors.forEach(sensor => {
            this.mqtt.publish(`homeassistant/climate/${this.config.mqtt.topic}_thermostat_${sensor.zone.id}/config`, JSON.stringify({
                name: "Thermostat " + sensor.zone.name,
                unit_of_mesaurement: "°C",
                unique_id: "dovit2mqtt_thermostat_" + sensor.zone.id,
                mode: ["off", "auto"],
                mode_command_topic: `${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/mode/set`,
                mode_state_topic: `${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/mode`,
                current_temperature_topic: `${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/temperature`,
                temperature_command_topic: `${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/temperature_desired/set`,
                temperature_state_topic: `${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/temperature_desired`,
            }))

            this.mqtt.subscribe(`${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/mode/set`)
            this.mqtt.subscribe(`${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/temperature_desired/set`)
        })

        this.mqtt.on("message", (topic, message) => {
            const zoneid = topic.split("/")[1].replace("thermostat_", "")
            const param = topic.split("/")[2]
            const action = topic.split("/")[3]

            if (param == "temperature_desired" && action == "set" && this.zone_desired_temperature[zoneid] != undefined) {
                var id = this.zone_desired_temperature[zoneid].id
                this.dovit.sendCommand(id, 0, message)
            }
         })
    }

}