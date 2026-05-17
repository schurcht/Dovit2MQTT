import Module from "./module.js"

export default class LightsModule extends Module {

    lights = []
    _messageHandlerBound = false

    constructor(config, dovit, mqtt) {
        dovit.loadDevices().then(devices => {
            var lights = devices.filter(e => e.functions.find(f => f.function == "Lights App"))

            for (var light of lights) {
                this.lights[light.id] = { id: light.id, name: light.name, state: "OFF" }
            }

            this.publishDevices()
        })
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

        this.mqtt.publish(`${this.config.mqtt.topic}/${device.name}`, JSON.stringify(this.lights[device.id]))
        this.mqtt.publish(`${this.config.mqtt.topic}/${device.id}/state`, this.lights[device.id]["state"])
    }

    async publishDevices() {
        this.lights.forEach(light => {
            this.mqtt.publish(`homeassistant/light/${this.config.mqtt.topic}_${light.id}/config`, JSON.stringify({
                name: light.name,
                unique_id: "dovit2mqtt_" + light.id,
                state_topic: `${this.config.mqtt.topic}/${light.id}/state`,
                command_topic: `${this.config.mqtt.topic}/${light.id}/set`,
                icon: "mdi:lightbulb"
            }))

            this.mqtt.subscribe(`${this.config.mqtt.topic}/${light.id}/set`)
        })

        if (!this._messageHandlerBound) {
            this._messageHandlerBound = true
            this.mqtt.on("message", (topic, message) => {
                const parts = topic.split("/")
                if (parts.length !== 3 || parts[2] !== "set") return

                const id = parts[1]
                if (this.lights[id] == undefined) return

                console.log("Sending command to dovit for light #", id, "to set", message.toString())
                this.dovit.sendCommand(id, 0, message == "ON" ? 1 : 0)
            })
        }
    }

}