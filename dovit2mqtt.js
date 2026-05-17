import fs from 'fs'
import Bridge from "./bridge.js"

const config = JSON.parse(fs.readFileSync("configuration.json").toString())

const envOverrides = {
    "DOVIT_IP": ["dovit", "ip"],
    "DOVIT_DP_PORT": ["dovit", "dpPort"],
    "DOVIT_UI_PORT": ["dovit", "uiPort"],
    "MQTT_URL": ["mqtt", "url"],
    "MQTT_TOPIC": ["mqtt", "topic"],
    "MQTT_USERNAME": ["mqtt", "username"],
    "MQTT_PASSWORD": ["mqtt", "password"],
}
for (const [envKey, [section, field]] of Object.entries(envOverrides)) {
    if (process.env[envKey]) {
        config[section] = config[section] || {}
        config[section][field] = process.env[envKey]
    }
}

const bridge = new Bridge(config)
bridge.start()
