import fs from 'fs'
import Bridge from "./bridge.js"

const config = JSON.parse(fs.readFileSync("configuration.json").toString())
const bridge = new Bridge(config)

bridge.start()