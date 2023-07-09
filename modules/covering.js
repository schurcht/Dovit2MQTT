import Module from "./module.js"

export default class CoveringModule extends Module {

    // Climate module groups into zones all the functions related to climate control
    shutters = []

    constructor(config, dovit, mqtt) {
        super("Motors App", config, dovit, mqtt)
    }

    async handleSubfunction(device, func, message) {
        this.shutters[device.id] = this.shutters[device.id] || new WindowCoveringWrapper()

        if (func.subfunction != "raffstores") {
            console.warn("ShuttersModule: subfunction '" + func.subfunction + "' not supported")
            return;
        }

        console.log(" --- Shutters --- ")
        if (message.statevalue == 0) {
            this.shutters[device.id].stop(message)
        } else if (message.statevalue == 1) {
            this.shutters[device.id].up(message)
        } else if (message.statevalue == 2) {
            this.shutters[device.id].down(message)
        } else {
            console.log("unknown statevalue", message.statevalue)
        }

        //this.mqtt.publish(`${this.config.mqtt.topic}/${func.functionId}${device.zone.id}`, JSON.stringify(this.zones[device.zone.id]))
    }

}

const averageTimeToAngle = 1500 // ms
const averageTimeTo = 52500 // ms

class WindowCoveringWrapper {

    movementStart = undefined

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

            if (time <= 20){
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