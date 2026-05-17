import Module from "./module.js"

/**
 * Venetian blind (raffstore) module with time-based position and tilt estimation.
 *
 * Movement phases:
 *   Going DOWN (closing): tilt closes first (tiltTime), then blind descends
 *   Going UP   (opening): tilt opens first (tiltTime), then blind ascends
 *
 * Opening and closing have different travel times due to gravity.
 *
 * HA conventions:
 *   position: 0 = fully closed (down), 100 = fully open (up)
 *   tilt:     0 = blades closed,       100 = blades open
 */
export default class CoveringModule extends Module {

    shutters = []
    _messageHandlerBound = false
    _positionsRestored = false

    constructor(config, dovit, mqtt) {

        dovit.loadDevices().then(devices => {
            const matched = devices.filter(e =>
                e.functions.find(f => f.subfunction == "raffstores" || f.subfunction == "shutters")
            )

            const shutterCfg = config.shutters || {}
            const defaults = shutterCfg.default || {}
            const defaultOpen = defaults.openTravelTime ?? 52000
            const defaultClose = defaults.closeTravelTime ?? 54000
            const defaultTilt = defaults.tiltTime ?? 1300

            for (const device of matched) {
                const perDevice = shutterCfg[device.id] || {}
                this.shutters[device.id] = {
                    id: parseInt(device.id),
                    name: device.name,
                    zone: device.zone,
                    // Timing config (ms) — separate for up/down
                    openTravelTime: perDevice.openTravelTime ?? defaultOpen,
                    closeTravelTime: perDevice.closeTravelTime ?? defaultClose,
                    tiltTime: perDevice.tiltTime ?? defaultTilt,
                    // State
                    position: null,
                    tilt: null,
                    state: "stopped",
                    movementStart: undefined,
                    movementDirection: undefined,
                    moveTimer: undefined,
                }
            }

            this.publishDevices()
        })

        super("Motors App", config, dovit, mqtt)
    }

    // --- Timing helpers ---

    /** Full travel time for a given direction */
    _travelTime(shutter, direction) {
        return direction === "opening" ? shutter.openTravelTime : shutter.closeTravelTime
    }

    /** Position-only travel time (excludes tilt phase) for a given direction */
    _positionTravelTime(shutter, direction) {
        return this._travelTime(shutter, direction) - shutter.tiltTime
    }

    _applyMovement(shutter, elapsedMs, direction) {
        const tiltTime = shutter.tiltTime
        const posTravelTime = this._positionTravelTime(shutter, direction)
        const opening = direction === "opening"

        const tiltElapsed = Math.min(elapsedMs, tiltTime)
        const tiltDelta = (tiltElapsed / tiltTime) * 100

        if (opening) {
            shutter.tilt = Math.min(100, (shutter.tilt ?? 0) + tiltDelta)
        } else {
            shutter.tilt = Math.max(0, (shutter.tilt ?? 100) - tiltDelta)
        }

        const posElapsed = Math.max(0, elapsedMs - tiltTime)
        if (posElapsed > 0) {
            const posDelta = (posElapsed / posTravelTime) * 100
            if (opening) {
                shutter.position = Math.min(100, (shutter.position ?? 0) + posDelta)
            } else {
                shutter.position = Math.max(0, (shutter.position ?? 100) - posDelta)
            }
        }

        shutter.position = Math.round(Math.max(0, Math.min(100, shutter.position ?? 0)))
        shutter.tilt = Math.round(Math.max(0, Math.min(100, shutter.tilt ?? 0)))
    }

    // --- Dovit event handling ---

    async handleSubfunction(device, func, message) {
        const shutter = this.shutters[device.id]
        if (!shutter) return

        if (message.statevalue == 0) {
            if (shutter.movementStart) {
                const elapsed = Date.now() - shutter.movementStart
                if (elapsed <= 20) return
                this._applyMovement(shutter, elapsed, shutter.movementDirection)
                shutter.movementStart = undefined
                shutter.movementDirection = undefined
            }
            shutter.state = "stopped"
        } else if (message.statevalue == 1) {
            if (shutter.movementStart) return
            shutter.movementStart = Date.now()
            shutter.movementDirection = "opening"
            shutter.state = "opening"
        } else if (message.statevalue == 2) {
            if (shutter.movementStart) return
            shutter.movementStart = Date.now()
            shutter.movementDirection = "closing"
            shutter.state = "closing"
        }

        this._publishState(shutter)
    }

    // --- HA command handling ---

    openShutter(deviceId) {
        this._clearMoveTimer(deviceId)
        this.dovit.sendCommand(deviceId, 1, 1, 0)
    }

    closeShutter(deviceId) {
        this._clearMoveTimer(deviceId)
        this.dovit.sendCommand(deviceId, 1, 2, 0)
    }

    stopShutter(deviceId) {
        this._clearMoveTimer(deviceId)
        this.dovit.sendCommand(deviceId, 1, 0, 0)
    }

    setPosition(deviceId, targetPosition) {
        const shutter = this.shutters[deviceId]
        if (!shutter || shutter.position === null) return

        const current = shutter.position
        const diff = targetPosition - current
        if (Math.abs(diff) < 2) return

        const savedTilt = shutter.tilt ?? 50
        const direction = diff > 0 ? "opening" : "closing"
        const posTravelTime = this._positionTravelTime(shutter, direction)
        const moveTime = (Math.abs(diff) / 100) * posTravelTime + shutter.tiltTime

        this._clearMoveTimer(deviceId)

        console.log(`Setting shutter ${deviceId} position to ${targetPosition}% (${direction} for ${Math.round(moveTime)}ms, will restore tilt to ${savedTilt}%)`)
        this.dovit.sendCommand(deviceId, 1, diff > 0 ? 1 : 2, 0)

        shutter.moveTimer = setTimeout(() => {
            this.dovit.sendCommand(deviceId, 1, 0, 0)
            shutter.moveTimer = undefined
            this._restoreTilt(deviceId, savedTilt, direction)
        }, moveTime)
    }

    _restoreTilt(deviceId, targetTilt, previousDirection) {
        const shutter = this.shutters[deviceId]
        if (!shutter) return

        const currentTilt = previousDirection === "opening" ? 100 : 0
        const diff = targetTilt - currentTilt
        if (Math.abs(diff) < 5) return

        // Tilt correction is the opposite direction of the position move
        const moveTime = (Math.abs(diff) / 100) * shutter.tiltTime

        setTimeout(() => {
            console.log(`Restoring shutter ${deviceId} tilt from ${currentTilt}% to ${targetTilt}% (${Math.round(moveTime)}ms)`)
            this.dovit.sendCommand(deviceId, 1, diff > 0 ? 1 : 2, 0)
            shutter.moveTimer = setTimeout(() => {
                this.dovit.sendCommand(deviceId, 1, 0, 0)
                shutter.moveTimer = undefined
            }, moveTime)
        }, 500)
    }

    setTilt(deviceId, targetTilt) {
        const shutter = this.shutters[deviceId]
        if (!shutter || shutter.tilt === null) return

        const current = shutter.tilt
        const diff = targetTilt - current
        if (Math.abs(diff) < 5) return

        const moveTime = (Math.abs(diff) / 100) * shutter.tiltTime
        this._clearMoveTimer(deviceId)

        console.log(`Setting shutter ${deviceId} tilt to ${targetTilt}% (${diff > 0 ? "opening" : "closing"} for ${Math.round(moveTime)}ms)`)
        this.dovit.sendCommand(deviceId, 1, diff > 0 ? 1 : 2, 0)

        shutter.moveTimer = setTimeout(() => {
            this.dovit.sendCommand(deviceId, 1, 0, 0)
            shutter.moveTimer = undefined
        }, moveTime)
    }

    _clearMoveTimer(deviceId) {
        const shutter = this.shutters[deviceId]
        if (shutter && shutter.moveTimer) {
            clearTimeout(shutter.moveTimer)
            shutter.moveTimer = undefined
        }
    }

    // --- Restore positions from MQTT retained values on startup ---

    restorePositions() {
        const activeShutters = this.shutters.filter(Boolean)
        if (activeShutters.length === 0) return

        console.log("Restoring shutter positions from MQTT...")

        for (const shutter of activeShutters) {
            this.mqtt.subscribe(`${this.config.mqtt.topic}/${shutter.id}/position`)
            this.mqtt.subscribe(`${this.config.mqtt.topic}/${shutter.id}/tilt`)
        }

        setTimeout(() => {
            for (const shutter of activeShutters) {
                this.mqtt.unsubscribe(`${this.config.mqtt.topic}/${shutter.id}/position`)
                this.mqtt.unsubscribe(`${this.config.mqtt.topic}/${shutter.id}/tilt`)
            }

            const restored = activeShutters.filter(s => s.position !== null)
            const unknown = activeShutters.filter(s => s.position === null)
            console.log(`Restored ${restored.length}/${activeShutters.length} shutter positions`)
            if (unknown.length > 0) {
                console.log(`Shutters with unknown position: ${unknown.map(s => s.name).join(", ")} — press Calibrate in HA`)
            }
        }, 3000)
    }

    // --- Calibration (on-demand via HA button) ---

    calibrate() {
        const activeShutters = this.shutters.filter(Boolean)
        if (activeShutters.length === 0) return

        const savedStates = []
        for (const shutter of activeShutters) {
            savedStates[shutter.id] = {
                position: shutter.position,
                tilt: shutter.tilt
            }
        }

        console.log(`Calibrating ${activeShutters.length} shutters (closing fully, then restoring positions)...`)

        for (const shutter of activeShutters) {
            // Calibrate by closing — use closeTravelTime
            this.dovit.sendCommand(shutter.id, 1, 2, 0)

            setTimeout(() => {
                this.dovit.sendCommand(shutter.id, 1, 0, 0)
                shutter.position = 0
                shutter.tilt = 0
                shutter.state = "stopped"
                shutter.movementStart = undefined
                shutter.movementDirection = undefined
                this._publishState(shutter)
                console.log(`Shutter ${shutter.name} calibrated (position=0, tilt=0)`)

                const saved = savedStates[shutter.id]
                if (saved && saved.position !== null && saved.position > 0) {
                    setTimeout(() => {
                        shutter.tilt = saved.tilt ?? 0
                        console.log(`Restoring ${shutter.name} to position=${saved.position}%, tilt=${shutter.tilt}%`)
                        this.setPosition(shutter.id, saved.position)
                    }, 1000)
                } else if (saved && saved.tilt !== null && saved.tilt > 0) {
                    setTimeout(() => {
                        console.log(`Restoring ${shutter.name} tilt to ${saved.tilt}%`)
                        this.setTilt(shutter.id, saved.tilt)
                    }, 1000)
                }
            }, shutter.closeTravelTime + 2000) // use closeTravelTime for calibration
        }
    }

    // --- MQTT publishing ---

    _publishState(shutter) {
        const topic = this.config.mqtt.topic
        this.mqtt.publish(`${topic}/${shutter.id}/state`, shutter.state, { retain: true })

        if (shutter.position !== null) {
            this.mqtt.publish(`${topic}/${shutter.id}/position`, shutter.position.toString(), { retain: true })
        }
        if (shutter.tilt !== null) {
            this.mqtt.publish(`${topic}/${shutter.id}/tilt`, shutter.tilt.toString(), { retain: true })
        }
    }

    // --- HA discovery ---

    async publishDevices() {
        this.shutters.forEach(shutter => {
            this.mqtt.publish(`homeassistant/cover/${this.config.mqtt.topic}_${shutter.id}/config`, JSON.stringify({
                unique_id: "dovit2mqtt_" + shutter.id,
                name: shutter.name,
                device_class: "shutter",
                state_topic: `${this.config.mqtt.topic}/${shutter.id}/state`,
                state_opening: "opening",
                state_closing: "closing",
                state_stopped: "stopped",
                command_topic: `${this.config.mqtt.topic}/${shutter.id}/set`,
                payload_open: "OPEN",
                payload_close: "CLOSE",
                payload_stop: "STOP",
                position_topic: `${this.config.mqtt.topic}/${shutter.id}/position`,
                set_position_topic: `${this.config.mqtt.topic}/${shutter.id}/position/set`,
                position_open: 100,
                position_closed: 0,
                tilt_status_topic: `${this.config.mqtt.topic}/${shutter.id}/tilt`,
                tilt_command_topic: `${this.config.mqtt.topic}/${shutter.id}/tilt/set`,
                tilt_opened_value: 100,
                tilt_closed_value: 0,
                tilt_min: 0,
                tilt_max: 100,
                availability_topic: `${this.config.mqtt.topic}/bridge/state`,
                availability_template: "{{ value_json.state }}",
                payload_available: "online",
                payload_not_available: "offline",
                suggested_area: shutter.zone.name,
                device: {
                    identifiers: ["dovit2mqtt_" + shutter.id],
                    manufacturer: "Dovit",
                    model: "Raffstore",
                    name: shutter.name
                }
            }), { retain: true })

            this.mqtt.subscribe(`${this.config.mqtt.topic}/${shutter.id}/set`)
            this.mqtt.subscribe(`${this.config.mqtt.topic}/${shutter.id}/position/set`)
            this.mqtt.subscribe(`${this.config.mqtt.topic}/${shutter.id}/tilt/set`)
        })

        // Calibrate button entity
        this.mqtt.publish(`homeassistant/button/${this.config.mqtt.topic}_calibrate_shutters/config`, JSON.stringify({
            unique_id: "dovit2mqtt_calibrate_shutters",
            name: "Calibrate Shutters",
            icon: "mdi:blinds",
            command_topic: `${this.config.mqtt.topic}/shutters/calibrate`,
            availability_topic: `${this.config.mqtt.topic}/bridge/state`,
            availability_template: "{{ value_json.state }}",
            payload_available: "online",
            payload_not_available: "offline",
            device: {
                identifiers: ["dovit2mqtt_bridge"],
                manufacturer: "Dovit",
                model: "dovit2mqtt Bridge",
                name: "Dovit Bridge"
            }
        }), { retain: true })

        this.mqtt.subscribe(`${this.config.mqtt.topic}/shutters/calibrate`)

        if (!this._messageHandlerBound) {
            this._messageHandlerBound = true
            this.mqtt.on("message", (topic, message) => {
                const parts = topic.split("/")
                if (parts.length < 3) return

                if (parts[1] === "shutters" && parts[2] === "calibrate") {
                    console.log("Calibrate button pressed")
                    this.calibrate()
                    return
                }

                const id = parseInt(parts[1])
                if (isNaN(id) || !this.shutters[id]) return

                const cmd = message.toString()
                const action = parts[2]

                if (!this._positionsRestored) {
                    if (action === "position" && parts.length === 3 && this.shutters[id].position === null) {
                        const val = parseInt(cmd)
                        if (!isNaN(val)) {
                            this.shutters[id].position = val
                            console.log(`Restored ${this.shutters[id].name} position: ${val}%`)
                        }
                        return
                    }
                    if (action === "tilt" && parts.length === 3 && this.shutters[id].tilt === null) {
                        const val = parseInt(cmd)
                        if (!isNaN(val)) {
                            this.shutters[id].tilt = val
                            console.log(`Restored ${this.shutters[id].name} tilt: ${val}%`)
                        }
                        return
                    }
                }

                if (action === "set" && parts.length === 3) {
                    if (cmd === "OPEN") {
                        console.log("Opening shutter " + id)
                        this.openShutter(id)
                    } else if (cmd === "CLOSE") {
                        console.log("Closing shutter " + id)
                        this.closeShutter(id)
                    } else if (cmd === "STOP") {
                        console.log("Stopping shutter " + id)
                        this.stopShutter(id)
                    }
                } else if (action === "position" && parts[3] === "set") {
                    const target = parseInt(cmd)
                    if (!isNaN(target)) {
                        console.log(`Set position shutter ${id} to ${target}%`)
                        this.setPosition(id, target)
                    }
                } else if (action === "tilt" && parts[3] === "set") {
                    const target = parseInt(cmd)
                    if (!isNaN(target)) {
                        console.log(`Set tilt shutter ${id} to ${target}%`)
                        this.setTilt(id, target)
                    }
                }
            })
        }
    }

}
