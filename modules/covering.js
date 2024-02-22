import Module from "./module.js"

export default class CoveringModule extends Module {

    shutters = []


    constructor(config, dovit, mqtt) {

        dovit.loadDevices().then(devices => {
            var shutters = devices.filter(e => e.functions.find(f => f.subfunction == "raffstores"))

            for (var shutter of shutters) {
                this.shutters[shutter.id] = new WindowCoveringWrapper(parseInt(shutter.id), "Shutter " + shutter.name, "STOP")
            }

            this.publishDevices()
        })

        super("Motors App", config, dovit, mqtt)
    }

    async handleSubfunction(device, func, message) {
        this.shutters[device.id] = this.shutters[device.id] || new WindowCoveringWrapper()

        console.log("Handling subfunction", func.subfunction, "for device", device.name, "with message", JSON.stringify(message))

        if (message.statevalue == 0) {
            this.shutters[device.id].stop(message)
        } else if (message.statevalue == 1) {
            this.shutters[device.id].up(message)
        } else if (message.statevalue == 2) {
            this.shutters[device.id].down(message)
        } else {
            console.log("unknown statevalue", message.statevalue)
        }

        //this.stopShutter(30)

        //this.mqtt.publish(`${this.config.mqtt.topic}/${func.functionId}${device.zone.id}`, JSON.stringify(this.zones[device.zone.id]))
    }

    openShutter(deviceId) {
        this.dovit.sendCommand(deviceId, 1, 1, 0)
        this.mqtt.publish(`${this.config.mqtt.topic}/${deviceId}/state`, "opening")
        setTimeout(() => {
            this.mqtt.publish(`${this.config.mqtt.topic}/${deviceId}/state`, "stopped")
        })
    }

    closeShutter(deviceId) {
        this.dovit.sendCommand(deviceId, 1, 2, 0)
        this.mqtt.publish(`${this.config.mqtt.topic}/${deviceId}/state`, "closing")
        setTimeout(() => {
            this.mqtt.publish(`${this.config.mqtt.topic}/${deviceId}/state`, "stopped")
        })
    }

    stopShutter(deviceId) {
        this.dovit.sendCommand(deviceId, 1, 0, 0)
        this.mqtt.publish(`${this.config.mqtt.topic}/${deviceId}/state`, "stopped")
    }

    async publishDevices() {
        this.shutters.forEach(shutter => {
            this.mqtt.publish(`homeassistant/cover/${this.config.mqtt.topic}_${shutter.id}/config`, JSON.stringify({
                unique_id: "dovit2mqtt_" + shutter.id,
                name: shutter.name,
                device_class: "shutter",
                state_topic: `${this.config.mqtt.topic}/${shutter.id}/state`,
                command_topic: `${this.config.mqtt.topic}/${shutter.id}/set`,
            }))

            this.mqtt.subscribe(`${this.config.mqtt.topic}/${shutter.id}/set`)
        })

        this.mqtt.on("message", (topic, message) => {
            const id = parseInt(topic.split("/")[1])
            const action = topic.split("/")[2]

            if (action == "set" && this.shutters[id] != undefined) {
                if (message == "OPEN") {
                    console.log("Opening shutter " + id)
                    this.openShutter(id)
                } else if (message == "CLOSE") {
                    console.log("Closing shutter " + id)
                    this.closeShutter(id)
                } else if (message == "STOP") {
                    console.log("Stopping shutter " + id)
                    this.stopShutter(id)
                }
            }
        })
    }

}

const averageTimeToAngle = 1500 // ms
const averageTimeTo = 52500 // ms

class WindowCoveringWrapper {

    movementStart = undefined

    constructor(id, name, state) {
        this.id = id
        this.name = name
        this.state = state
    }

    up(message) {
        if (this.movementStart) {
            this.stop(message)
            return
        }

        this.movementStart = new Date()
        console.log("Opening")
    }

    down(message) {
        if (this.movementStart) {
            this.stop(message)
            return
        }

        this.movementStart = new Date()
        console.log("Closing")
    }

    stop(message) {
        if (this.movementStart) {
            let time = new Date() - this.movementStart

            if (time <= 20) {
                // Debounce for long press
                console.log("debounce due to time being " + time + "ms")
                return
            }

            this.movementStart = undefined
            console.log("end of movement after " + time + "ms ,", message.timefleeting)
        } else {
            console.log("stop called without movement start")
        }
    }

}