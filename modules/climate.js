import Module from "./module.js"

export default class ClimateModule extends Module {

    zones = []
    temperature_sensors = []
    zone_desired_temperature = []
    zone_modes = []
    overrideTemps = []
    _messageHandlerBound = false

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

            for (var thermostat of devices.filter(e => e.functions.find(f => f.subfunction == "season mode"))) {
                this.zone_modes[thermostat.zone.id] = thermostat
            }

            this.publishDevices()
        })

        super("Clima App", config, dovit, mqtt)
    }

    async handleSubfunction(device, func, message) {
        this.zones[device.zone.id] = this.zones[device.zone.id] || {}

        switch (func.subfunction) {
            case "temperature":
                if (message.statevalue == -32768) break // no data sentinel, skip
                this.zones[device.zone.id]["local_temperature"] = message.statevalue
                console.log("Updating temperature for zone " + device.zone.name + " to " + message.statevalue)
                this.mqtt.publish(`${this.config.mqtt.topic}/thermostat_${device.zone.id}/temperature`, message.statevalue.toString(), { retain: true })
                break;
            case "set point T":
                this.zones[device.zone.id]["occupied_heating_setpoint"] = message.statevalue
                console.log('Updating desired temperature for zone ' + device.zone.name + ' to ' + message.statevalue)
                if (message.statevalue == 101) {
                    // 101 = thermostat is off
                    this.zones[device.zone.id]["off"] = true
                    this.mqtt.publish(`${this.config.mqtt.topic}/thermostat_${device.zone.id}/mode`, 'off', { retain: true })
                    this.mqtt.publish(`${this.config.mqtt.topic}/thermostat_${device.zone.id}/action`, 'off', { retain: true })
                } else {
                    this.zones[device.zone.id]["off"] = false
                    this.mqtt.publish(`${this.config.mqtt.topic}/thermostat_${device.zone.id}/temperature_desired`, message.statevalue.toString(), { retain: true })
                }
                break;
            case "valve":
                this.zones[device.zone.id]["valve_state"] = message.statevalue == 1 ? "open" : "closed"
                if (!this.zones[device.zone.id]["off"]) {
                    this.mqtt.publish(`${this.config.mqtt.topic}/thermostat_${device.zone.id}/action`, message.statevalue == 1 ? "heating" : "off", { retain: true })
                }
                break;
            case "season mode":
                this.zones[device.zone.id]["season_mode"] = message.statevalue == 1 ? "winter" : "summer"
                // Only publish mode if thermostat is not off (setpoint 101 takes priority)
                if (!this.zones[device.zone.id]["off"]) {
                    this.mqtt.publish(`${this.config.mqtt.topic}/thermostat_${device.zone.id}/mode`, message.statevalue == 1 ? "heat" : "cool", { retain: true })
                }
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

        this.mqtt.publish(`${this.config.mqtt.topic}/${device.name}`, JSON.stringify(this.zones[device.zone.id]), { retain: true })
    }

    async publishDevices() {
        this.temperature_sensors.forEach(sensor => {
            // Publish climate entity (thermostat control)
            this.mqtt.publish(`homeassistant/climate/${this.config.mqtt.topic}_thermostat_${sensor.zone.id}/config`, JSON.stringify({
                name: "Thermostat " + sensor.zone.name,
                unique_id: "dovit2mqtt_thermostat_" + sensor.zone.id,
                temperature_unit: "C",
                precision: 0.1,
                min_temp: 5,
                max_temp: 35,
                temp_step: 0.5,
                modes: ["heat", "cool", "off"],
                action_topic: `${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/action`,
                mode_state_topic: `${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/mode`,
                mode_command_topic: `${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/mode/set`,
                current_temperature_topic: `${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/temperature`,
                temperature_command_topic: `${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/temperature_desired/set`,
                temperature_state_topic: `${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/temperature_desired`,
                availability_topic: `${this.config.mqtt.topic}/bridge/state`,
                availability_template: "{{ value_json.state }}",
                payload_available: "online",
                payload_not_available: "offline",
                suggested_area: sensor.zone.name,
                device: {
                    identifiers: ["dovit2mqtt_thermostat_" + sensor.zone.id],
                    manufacturer: "Dovit",
                    model: "D-CT-85-W",
                    name: "Thermostat " + sensor.zone.name
                }
            }), { retain: true })

            this.mqtt.publish(`homeassistant/sensor/${this.config.mqtt.topic}_temperature_${sensor.zone.id}/config`, JSON.stringify({
                name: sensor.zone.name + " Temperature",
                unique_id: "dovit2mqtt_temperature_" + sensor.zone.id,
                device_class: "temperature",
                state_class: "measurement",
                unit_of_measurement: "\u00b0C",
                state_topic: `${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/temperature`,
                availability_topic: `${this.config.mqtt.topic}/bridge/state`,
                availability_template: "{{ value_json.state }}",
                payload_available: "online",
                payload_not_available: "offline",
                suggested_area: sensor.zone.name,
                device: {
                    identifiers: ["dovit2mqtt_thermostat_" + sensor.zone.id],
                    manufacturer: "Dovit",
                    model: "D-CT-85-W",
                    name: "Thermostat " + sensor.zone.name
                }
            }), { retain: true })

            this.mqtt.subscribe(`${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/mode/set`)
            this.mqtt.subscribe(`${this.config.mqtt.topic}/thermostat_${sensor.zone.id}/temperature_desired/set`)
        })

        // Only bind the message handler once to avoid stacking listeners
        if (!this._messageHandlerBound) {
            this._messageHandlerBound = true
            this.mqtt.on("message", (topic, message) => {
                const zoneid = topic.split("/")[1].replace("thermostat_", "")
                const param = topic.split("/")[2]
                const action = topic.split("/")[3]

                if (param == "temperature_desired" && action == "set" && this.zone_desired_temperature[zoneid] != undefined) {
                    var id = this.zone_desired_temperature[zoneid].id
                    this.dovit.sendCommand(id, 0, message)
                }
                if (param == "mode" && action == "set" && this.zone_desired_temperature[zoneid] != undefined) {
                    var id = this.zone_modes[zoneid].id
                    switch (message.toString()) {
                        case "off":
                            this.dovit.sendCommand(this.zone_desired_temperature[zoneid].id, 0, 101)
                            this.mqtt.publish(`${this.config.mqtt.topic}/thermostat_${zoneid}/mode`, 'off', { retain: true })
                            console.log("Setting thermostat to off")
                            return;
                        case "cool":
                            this.dovit.sendCommand(id, 0, 0)
                            console.log("Setting thermostat to summer mode")
                            return;
                        case "heat":
                            this.dovit.sendCommand(id, 0, 1)
                            console.log("Setting thermostat to winter mode")
                            return;
                    }
                }
            })
        }
    }

}
