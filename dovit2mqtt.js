import fs from 'fs'
import http from 'http'
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

const healthPort = parseInt(process.env.HEALTH_PORT || '8080', 10)
http.createServer((req, res) => {
    if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
        return
    }
    if (req.url === '/readyz') {
        const mqtt = !!bridge.mqtt?.connected
        const dovit = !!bridge.dovit?.connected
        const ready = mqtt && dovit
        res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
            ready,
            mqtt: mqtt ? 'ok' : 'down',
            dovit: dovit ? 'ok' : 'down',
        }))
        return
    }
    res.writeHead(404)
    res.end()
}).listen(healthPort, () => {
    console.log(`Health server listening on :${healthPort}`)
})
