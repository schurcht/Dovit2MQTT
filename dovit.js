import net from "net"
import { EventEmitter } from "events";
import { XMLParser } from "fast-xml-parser";
import axios from "axios";

export default class Dovit extends EventEmitter {

    dp = new net.Socket();
    messageBuffer = "";

    devices = []

    constructor(ip, dp, ui) {
        super();
        this.ip = ip;
        this.dpPort = dp;
        this.uiPort = ui;
    }

    connect() {
        const client = this;
        return new Promise(async (resolve) => {
            client.dp = new net.Socket();
            await Promise.all([client.loadZones(), this.loadFunctions()])
            await client.loadDevices();
            client.dp.connect(this.dpPort, this.ip, () => {
                this.dp.write(Buffer.from('<hisynch-ask></hisynch-ask>\u0000'))
                client.dp.on('data', (data) => client.__handleData(client, data));
                resolve();
            });
        })
    }

    async getAllDevices() {
        return this.devices;
    }

    async getAllFunctions() {
        return this.functions;
    }

    async getAllZones() {
        return this.zones;
    }

    async loadDevices() {
        const res = await axios.get(`http://${this.ip}:${this.uiPort}/client/hidv-config-list.s`)

        const devices = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        }).parse(res.data)['hidv-config-list']['device']

        this.devices = devices.map(device => {
            let zone = undefined
            if (device['geozone'] != undefined)
                zone = device['geozone']['@_id']

            let functions = []
            if (device['functzones'] != undefined)
                functions = device["functzones"]["function"]

            let subfunctions = (Array.isArray(functions) ? functions : [functions]).map(e => [{ function: e["@_id"], subfunction: e["funcsubzone"]["@_id"] }])

            return {
                id: device['@_id'],
                name: device['dvlabel'],
                description: device['description'],
                type: device['type'],
                zone: {
                    id: zone,
                    name: (this.zones.find(e => e.id == zone) ?? { name: "" }).name
                },
                functions: subfunctions.flat().map(e => {
                    const func = this.functions.find(f => f.id == e.function)
                    return {
                        function: func.name,
                        functionId: func.id,
                        subfunction: func.subfunctions.find(subfunction => subfunction.id == e.subfunction).name,
                        subfunctionId: e.subfunction
                    }
                }),
            }
        })

        this.devices = this.devices.filter(e => !(e.zone.name == "Overview" && e.description == "Zone RISCO"))
    }

    async loadFunctions() {
        const res = await axios.get(`http://${this.ip}:${this.uiPort}/client/hifunction-map.c`)

        const functions = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
        }).parse(res.data)['hifunction-map']['function']

        this.functions = functions.map(device => {

            let subfunctions = []
            if (device["subfunctions"] == undefined) {
                subfunctions = []
            } else if (Array.isArray(device["subfunctions"]["subfunction"])) {
                subfunctions = device["subfunctions"]["subfunction"]
            } else {
                subfunctions = [device["subfunctions"]["subfunction"]]
            }

            return {
                id: device['@_id'],
                name: device['label'],
                subfunctions: subfunctions.filter(e => e != undefined).map(subfunction => {
                    return {
                        id: subfunction['@_id'],
                        name: subfunction['#text'],
                    }
                })
            }
        })
    }

    async loadZones() {
        const res = await axios.get(`http://${this.ip}:${this.uiPort}/client/higeo-map.c`)

        const zones = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        }).parse(res.data)["higeo-map"]["geozone"]

        this.zones = zones.map(device => {
            return {
                id: device['@_id'],
                name: device['label'],
            }
        })
    }

    __handleData(client, data) {
        const message = (client.messageBuffer + data.toString())
        const chunks = message.split("\u0000")

        for (const nChunk in chunks) {
            if (nChunk == chunks.length - 1 && chunks[nChunk] != "") {
                console.log("Buffering data due to incomplete chunk")
                client.messageBuffer = chunks[nChunk]
                continue
            }

            const chunk = chunks[nChunk]
            if (chunk == "")
                continue

            client.messageBuffer = ""

            const parsedMessage = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: "@_"
            }).parse(chunk)

            client.__handleMessage(parsedMessage)
        }
    }

    __handleMessage(message) {
        if (Object.values(message).length > 1) {
            console.error("Message has more than one root element")
            return
        }

        const type = Object.keys(message)[0]
        if (type == "hidv-state") {
            const device = message['hidv-state']['device']

            this.emit("deviceUpdate", device)
        } else {
            console.warn("Received unsupported message type: " + type)
        }
    }
}